import { Client, ConnectConfig } from "ssh2";
import { decrypt } from "../../lib/encryption";
import { Server } from "@prisma/client";

export async function executeSSHCommand(server: Server, command: string): Promise<{ stdout: string, stderr: string, code: number }> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        let decryptedCred = "";
        try {
            decryptedCred = decrypt(server.credential);
        } catch (e) {
            return reject(new Error("Failed to decrypt server credentials. Cannot connect via SSH."));
        }

        const config: ConnectConfig = {
            host: server.ip,
            port: server.sshPort || 22,
            username: server.sshUser || "root",
            readyTimeout: 10000,
        };

        if (server.authMethod === "PASSWORD") {
            config.password = decryptedCred;
        } else {
            config.privateKey = decryptedCred;
        }

        conn.on("ready", () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                let stdout = "";
                let stderr = "";

                stream.on("close", (code: number, signal: string) => {
                    conn.end();
                    resolve({ stdout, stderr, code: code || 0 });
                }).on("data", (data: Buffer) => {
                    stdout += data.toString("utf8");
                }).stderr.on("data", (data: Buffer) => {
                    stderr += data.toString("utf8");
                });
            });
        }).on("error", (err) => {
            reject(err);
        }).connect(config);
    });
}
