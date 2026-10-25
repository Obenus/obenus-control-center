import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access";
import { loadOfficialAgent, saveOfficialAgent, validateAgentContent } from "@/core/nova/agentPackage";
import { logAudit } from "@/lib/audit";
import { enqueueNovaJob } from "@/lib/queue";

export async function GET() {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const agent = await loadOfficialAgent();
        return NextResponse.json({
            version: agent.version,
            sha256: agent.sha256,
            source: agent.source,
            updatedAt: agent.updatedAt || null,
            sizeBytes: agent.content.length,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "No se pudo cargar el agente" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const form = await req.formData();
        const file = form.get("file");
        const refreshAfter = String(form.get("refreshAfter") || "true") !== "false";

        if (!file || typeof file === "string") {
            return NextResponse.json({ error: "Debe adjuntar un archivo .py" }, { status: 400 });
        }

        const blob = file as File;
        const name = (blob.name || "obenus-nova.py").toLowerCase();
        if (!name.endsWith(".py")) {
            return NextResponse.json({ error: "Solo se admiten archivos .py" }, { status: 400 });
        }

        const buffer = Buffer.from(await blob.arrayBuffer());
        const validation = validateAgentContent(buffer);
        if (!validation.ok) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const previous = await loadOfficialAgent().catch(() => null);
        const saved = await saveOfficialAgent(buffer, { fileName: blob.name });

        await logAudit(
            admin.user.id,
            "NOVA_UPLOAD_AGENT",
            "AppConfig",
            "NOVA_OFFICIAL_AGENT",
            `Nueva versión oficial NOVA ${saved.version} (SHA ${saved.sha256.slice(0, 12)}…). Anterior: ${previous?.version || "n/d"}`,
            req.headers.get("x-forwarded-for") || undefined
        );

        if (refreshAfter) {
            await enqueueNovaJob("nova-refresh-all", { userId: admin.user.id });
        }

        return NextResponse.json({
            success: true,
            version: saved.version,
            sha256: saved.sha256,
            source: saved.source,
            updatedAt: saved.updatedAt,
            previousVersion: previous?.version || null,
            previousSha256: previous?.sha256 || null,
            changed: !previous || previous.sha256 !== saved.sha256,
            message: saved.sha256 === previous?.sha256
                ? "El archivo es idéntico a la versión oficial actual"
                : `Versión ${saved.version} publicada. Use «Actualización masiva» para desplegarla en los servidores.`,
        });
    } catch (e: any) {
        console.error("NOVA agent upload error:", e?.message);
        return NextResponse.json({ error: e?.message || "No se pudo guardar el agente" }, { status: 500 });
    }
}
