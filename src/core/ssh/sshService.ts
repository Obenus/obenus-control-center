import { Client, ConnectConfig, SFTPWrapper } from "ssh2";
import crypto from "crypto";
import { decrypt } from "../../lib/encryption";
import { Server } from "@prisma/client";

const DEFAULT_TIMEOUT_MS = 30000;
/** Tareas de mantenimiento (yum/apt, limpiezas pesadas): el timeout corto corta la ejecución a medias. */
export const REMOTE_TASK_TIMEOUT_MS = 20 * 60 * 1000;

export class SshHostKeyError extends Error {
    code: "HOST_KEY_UNCONFIRMED" | "HOST_KEY_CHANGED";
    fingerprint: string;
    constructor(code: "HOST_KEY_UNCONFIRMED" | "HOST_KEY_CHANGED", fingerprint: string) {
        super(
            code === "HOST_KEY_UNCONFIRMED"
                ? `Clave de host SSH no confirmada: ${fingerprint}`
                : `Clave de host SSH distinta a la guardada: ${fingerprint}`
        );
        this.code = code;
        this.fingerprint = fingerprint;
    }
}

export function fingerprintFromHostKey(key: Buffer): string {
    const hash = crypto.createHash("sha256").update(key).digest("base64");
    return `SHA256:${hash}`;
}

function buildConfig(server: Server): ConnectConfig {
    let decryptedCred = "";
    try {
        decryptedCred = decrypt(server.credential);
    } catch {
        throw new Error("Failed to decrypt server credentials. Cannot connect via SSH.");
    }

    const config: ConnectConfig = {
        host: server.ip,
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        readyTimeout: 15000,
    };

    if (server.authMethod === "PASSWORD") {
        config.password = decryptedCred;
    } else {
        config.privateKey = decryptedCred;
    }

    return config;
}

/** Solo obtiene fingerprint sin autenticar (para UI de confirmación). */
export function probeHostKeyFingerprint(
    host: string,
    port: number,
    timeoutMs = 12000
): Promise<string> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let settled = false;
        let seenFp = "";

        const done = (err?: Error, fp?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                conn.end();
            } catch {
                /* ignore */
            }
            if (err) reject(err);
            else resolve(fp as string);
        };

        const timer = setTimeout(() => {
            done(new Error("Timeout al leer clave de host"));
        }, timeoutMs);

        conn.on("error", (err) => {
            // Tras capturar la clave, ssh2 emite "Host denied" o fallo de auth: no es un error real.
            if (seenFp) {
                done(undefined, seenFp);
                return;
            }
            done(err instanceof Error ? err : new Error(String(err)));
        })
            .on("ready", () => {
                // No debería autenticar con credenciales dummy; si llega, ya tenemos fp.
                if (seenFp) done(undefined, seenFp);
                else done(new Error("Se conectó sin capturar host key"));
            })
            .connect({
                host,
                port,
                username: "obenus-hostkey-probe",
                password: "invalid-probe-password",
                readyTimeout: timeoutMs,
                tryKeyboard: false,
                hostVerifier: (key: Buffer) => {
                    seenFp = fingerprintFromHostKey(key);
                    // Aceptar la clave para completar el handshake; el auth fallará después.
                    return true;
                },
            });
    });
}

export function withSSHConnection<T>(
    server: Server,
    fn: (conn: Client) => Promise<T>,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                conn.end();
                reject(new Error(`SSH timeout after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        const finish = (err?: Error, value?: T) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                conn.end();
            } catch {
                /* ignore */
            }
            if (err) reject(err);
            else resolve(value as T);
        };

        try {
            const config = buildConfig(server);
            let seenFp = "";
            const stored = (server as any).sshHostFingerprint as string | null | undefined;
            config.hostVerifier = (key: Buffer) => {
                seenFp = fingerprintFromHostKey(key);
                if (!stored) return false;
                return stored === seenFp;
            };
            conn.on("ready", () => {
                fn(conn)
                    .then((value) => finish(undefined, value))
                    .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
            })
                .on("error", (err) => {
                    if (seenFp && !stored) {
                        finish(new SshHostKeyError("HOST_KEY_UNCONFIRMED", seenFp));
                        return;
                    }
                    if (seenFp && stored && seenFp !== stored) {
                        finish(new SshHostKeyError("HOST_KEY_CHANGED", seenFp));
                        return;
                    }
                    finish(err);
                })
                .connect(config);
        } catch (err) {
            finish(err instanceof Error ? err : new Error(String(err)));
        }
    });
}

export async function executeSSHCommand(
    server: Server,
    command: string,
    options?: { timeoutMs?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; code: number }> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return withSSHConnection(
        server,
        (conn) =>
            new Promise((resolve, reject) => {
                const onExec = (err: Error | undefined, stream: any) => {
                    if (err) return reject(err);

                    let stdout = "";
                    let stderr = "";

                    stream
                        .on("close", (code: number) => {
                            resolve({ stdout, stderr, code: code ?? 0 });
                        })
                        .on("data", (data: Buffer) => {
                            stdout += data.toString("utf8");
                        })
                        .stderr.on("data", (data: Buffer) => {
                            stderr += data.toString("utf8");
                        });
                };

                if (options?.env) {
                    conn.exec(command, { env: options.env }, onExec);
                } else {
                    conn.exec(command, onExec);
                }
            }),
        timeoutMs
    );
}

export async function uploadSSHFile(
    server: Server,
    remotePath: string,
    content: Buffer | string,
    mode = 0o600,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    await withSSHConnection(
        server,
        (conn) =>
            new Promise<void>((resolve, reject) => {
                conn.sftp((err, sftp: SFTPWrapper) => {
                    if (err) return reject(err);
                    const stream = sftp.createWriteStream(remotePath, { mode });
                    stream.on("close", () => resolve());
                    stream.on("error", (e: Error) => reject(e));
                    stream.end(data);
                });
            }),
        timeoutMs
    );
}

export async function downloadSSHFile(
    server: Server,
    remotePath: string,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Buffer> {
    return withSSHConnection(
        server,
        (conn) =>
            new Promise<Buffer>((resolve, reject) => {
                conn.sftp((err, sftp: SFTPWrapper) => {
                    if (err) return reject(err);
                    const chunks: Buffer[] = [];
                    const stream = sftp.createReadStream(remotePath);
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("end", () => resolve(Buffer.concat(chunks)));
                    stream.on("error", (e: Error) => reject(e));
                });
            }),
        timeoutMs
    );
}

export async function testSSHConnectivity(
    server: Server
): Promise<{ ok: boolean; message: string; hostKeyError?: SshHostKeyError }> {
    try {
        const { stdout, code } = await executeSSHCommand(
            server,
            "echo OK && uname -s && python3 --version 2>&1",
            { timeoutMs: 20000 }
        );
        if (code !== 0) return { ok: false, message: "SSH conectó pero el comando de prueba falló" };
        return { ok: true, message: stdout.trim() };
    } catch (e: any) {
        if (e instanceof SshHostKeyError) {
            return { ok: false, message: e.message, hostKeyError: e };
        }
        return { ok: false, message: e?.message || "Error de conexión SSH" };
    }
}
