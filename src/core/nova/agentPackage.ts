import crypto from "crypto";
import fs from "fs";
import path from "path";

const CANDIDATE_PATHS = [
    path.join(process.cwd(), "obenus-nova.py"),
    path.join(process.cwd(), "agents", "obenus-nova.py"),
    "/app/obenus-nova.py",
    path.resolve(__dirname, "../../../obenus-nova.py"),
];

export type OfficialAgent = {
    path: string;
    content: Buffer;
    version: string;
    sha256: string;
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

export function loadOfficialAgent(): OfficialAgent {
    const agentPath = resolveOfficialAgentPath();
    const content = fs.readFileSync(agentPath);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const text = content.toString("utf8");
    const match = text.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    const version = match?.[1] || "unknown";
    return { path: agentPath, content, version, sha256 };
}

export function compareAgentHash(installedSha256: string | null | undefined, officialSha256: string): boolean {
    if (!installedSha256) return false;
    return installedSha256.toLowerCase() === officialSha256.toLowerCase();
}
