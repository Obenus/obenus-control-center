import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { enqueueNovaJob, NovaJobName } from "@/lib/queue";
import { logAudit } from "@/lib/audit";
import { isLocked } from "@/core/nova/locks";

const ACTION_MAP: Record<string, NovaJobName> = {
    install: "nova-install",
    update: "nova-update",
    reinstall: "nova-reinstall",
    migrate: "nova-migrate",
    refresh: "nova-refresh",
    diagnose: "nova-diagnose",
    test_telegram: "nova-test-telegram",
    configure: "nova-configure",
};

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json();
        const action = String(body.action || "");
        const serverIds: string[] = Array.isArray(body.serverIds)
            ? body.serverIds
            : body.serverId
                ? [body.serverId]
                : [];

        if (!ACTION_MAP[action] && action !== "bulk_update" && action !== "refresh_all") {
            return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
        }

        if (action === "refresh_all") {
            const job = await enqueueNovaJob("nova-refresh-all", {
                userId: (session.user as any).id,
            });
            await logAudit((session.user as any).id, "NOVA_REFRESH_ALL", "NovaAgent", undefined, "Refresco global NOVA encolado", req.headers.get("x-forwarded-for") || undefined);
            return NextResponse.json({ queued: true, jobId: job.id });
        }

        if (action === "bulk_update") {
            if (!serverIds.length) {
                const outdated = await prisma.novaAgent.findMany({
                    where: { installStatus: "UPDATE_AVAILABLE" },
                    select: { serverId: true },
                });
                serverIds.push(...outdated.map((o) => o.serverId));
            }
            const job = await enqueueNovaJob("nova-bulk-update", {
                serverIds,
                userId: (session.user as any).id,
                disableLegacy: Boolean(body.disableLegacy),
            });
            await logAudit((session.user as any).id, "NOVA_BULK_UPDATE", "NovaAgent", undefined, `Actualización masiva (${serverIds.length} servidores)`, req.headers.get("x-forwarded-for") || undefined);
            return NextResponse.json({ queued: true, jobId: job.id, count: serverIds.length });
        }

        if (!serverIds.length) {
            return NextResponse.json({ error: "serverId requerido" }, { status: 400 });
        }

        const results = [];
        for (const serverId of serverIds) {
            const server = await prisma.server.findUnique({
                where: { id: serverId },
                include: { novaAgent: true },
            });
            if (!server) {
                results.push({ serverId, error: "No encontrado" });
                continue;
            }
            if (isLocked(server.novaAgent?.operationLockUntil)) {
                results.push({ serverId, error: "Operación en curso" });
                continue;
            }

            const jobName = ACTION_MAP[action];
            const job = await enqueueNovaJob(jobName, {
                serverId,
                userId: (session.user as any).id,
                force: Boolean(body.force),
                disableLegacy: Boolean(body.disableLegacy) || action === "migrate",
            }, { jobId: `nova-${action}-${serverId}-${Date.now()}` });

            results.push({ serverId, jobId: job.id, queued: true });
        }

        await logAudit(
            (session.user as any).id,
            `NOVA_${action.toUpperCase()}`,
            "NovaAgent",
            serverIds[0],
            `Acción NOVA ${action} encolada (${serverIds.length})`,
            req.headers.get("x-forwarded-for") || undefined
        );

        return NextResponse.json({ results });
    } catch (e: any) {
        console.error("NOVA action error:", e?.message);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
