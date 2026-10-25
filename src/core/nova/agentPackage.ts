import crypto from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/auth";

export const NOVA_AGENT_CONFIG_KEY = "NOVA_OFFICIAL_AGENT";
const MAX_AGENT_BYTES = 512 * 1024;

const CANDIDATE_PATHS = [
    path.join(process.cwd(), "agents", "obenus-nova.py"),
    path.join(process.cwd(), "obenus-nova.py"),
    "/app/agents/obenus-nova.py",
    "/app/obenus-nova.py",
    path.resolve(__dirname, "../../../agents/obenus-nova.py"),
    path.resolve(__dirname, "../../../obenus-nova.py"),
];

export type OfficialAgent = {
    path: string;
    content: Buffer;
    version: string;
    sha256: string;
    source: "database" | "file";
    updatedAt?: string | null;
};

type StoredAgent = {
    version: string;
    sha256: string;
    contentBase64: string;
    updatedAt: string;
    fileName?: string;
};

export function resolveOfficialAgentPath(): string {
    for (const p of CANDIDATE_PATHS) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch {
            /* continue */
        }
    }
    throw new Error("No se encuentra el agente oficial obenus-nova.py");
}

export function parseAgentMeta(content: Buffer): { version: string; sha256: string; text: string } {
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const text = content.toString("utf8");
    const match = text.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    const version = match?.[1] || "unknown";
    return { version, sha256, text };
}

/** Validación básica del script antes de aceptarlo como oficial */
export function validateAgentContent(content: Buffer): { ok: true; version: string; sha256: string } | { ok: false; error: string } {
    if (!content || content.length < 200) {
        return { ok: false, error: "El archivo es demasiado pequeño para ser un agente NOVA" };
    }
    if (content.length > MAX_AGENT_BYTES) {
        return { ok: false, error: `El archivo supera el máximo de ${MAX_AGENT_BYTES} bytes` };
    }
    const { version, sha256, text } = parseAgentMeta(content);
    if (!text.includes("#!/usr/bin/env python") && !text.includes("python3")) {
        return { ok: false, error: "El archivo no parece un script Python de NOVA" };
    }
    if (!/VERSION\s*=\s*['"][^'"]+['"]/.test(text)) {
        return { ok: false, error: "Falta la constante VERSION en el script" };
    }
    if (!text.includes("obenus") && !text.includes("NOVA") && !text.includes("nova")) {
        return { ok: false, error: "El contenido no parece el agente Obenus NOVA" };
    }
    if (!text.includes("--install") || !text.includes("--run")) {
        return { ok: false, error: "El agente no expone los modos --install / --run esperados" };
    }
    if (version === "unknown") {
        return { ok: false, error: "No se pudo leer VERSION del script" };
    }
    return { ok: true, version, sha256 };
}

function loadFromFile(): OfficialAgent {
    const agentPath = resolveOfficialAgentPath();
    const content = fs.readFileSync(agentPath);
    const { version, sha256 } = parseAgentMeta(content);
    return { path: agentPath, content, version, sha256, source: "file" };
}

async function loadFromDatabase(): Promise<OfficialAgent | null> {
    const row = await prisma.appConfig.findUnique({ where: { key: NOVA_AGENT_CONFIG_KEY } });
    if (!row) return null;
    try {
        const stored = JSON.parse(row.value) as StoredAgent;
        if (!stored.contentBase64) return null;
        const content = Buffer.from(stored.contentBase64, "base64");
        const { version, sha256 } = parseAgentMeta(content);
        return {
            path: "database:NOVA_OFFICIAL_AGENT",
            content,
            version: stored.version || version,
            sha256: stored.sha256 || sha256,
            source: "database",
            updatedAt: stored.updatedAt || row.updatedAt?.toISOString?.() || null,
        };
    } catch {
        return null;
    }
}

/** Carga el agente oficial: prioridad BD (subido por UI) → fichero embebido/montado */
export async function loadOfficialAgent(): Promise<OfficialAgent> {
    const fromDb = await loadFromDatabase();
    if (fromDb) return fromDb;
    return loadFromFile();
}

/** Guarda nueva versión oficial (BD + intento de escribir en agents/) */
export async function saveOfficialAgent(
    content: Buffer,
    opts?: { fileName?: string }
): Promise<OfficialAgent> {
    const validation = validateAgentContent(content);
    if (!validation.ok) {
        throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const stored: StoredAgent = {
        version: validation.version,
        sha256: validation.sha256,
        contentBase64: content.toString("base64"),
        updatedAt: now,
        fileName: opts?.fileName || "obenus-nova.py",
    };

    await prisma.appConfig.upsert({
        where: { key: NOVA_AGENT_CONFIG_KEY },
        update: { value: JSON.stringify(stored) },
        create: { key: NOVA_AGENT_CONFIG_KEY, value: JSON.stringify(stored) },
    });

    // Intento de espejo en disco (volumen agents/); no falla si no hay permisos
    tryMirrorToDisk(content);

    return {
        path: "database:NOVA_OFFICIAL_AGENT",
        content,
        version: validation.version,
        sha256: validation.sha256,
        source: "database",
        updatedAt: now,
    };
}

function tryMirrorToDisk(content: Buffer) {
    const targets = [
        path.join(process.cwd(), "agents", "obenus-nova.py"),
        "/app/agents/obenus-nova.py",
    ];
    for (const target of targets) {
        try {
            const dir = path.dirname(target);
            fs.mkdirSync(dir, { recursive: true });
            const backupDir = path.join(dir, "backups");
            if (fs.existsSync(target)) {
                fs.mkdirSync(backupDir, { recursive: true });
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                fs.copyFileSync(target, path.join(backupDir, `obenus-nova.py.bak-${stamp}`));
            }
            const tmp = `${target}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, content, { mode: 0o644 });
            fs.renameSync(tmp, target);
            return;
        } catch {
            /* siguiente destino */
        }
    }
}

export function compareAgentHash(installedSha256: string | null | undefined, officialSha256: string): boolean {
    if (!installedSha256) return false;
    return installedSha256.toLowerCase() === officialSha256.toLowerCase();
}
