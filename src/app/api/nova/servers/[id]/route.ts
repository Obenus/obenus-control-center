import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { loadOfficialAgent } from "@/core/nova/agentPackage";
import { statusLabel } from "@/core/nova/statusLabel";
import { enqueueNovaJob } from "@/lib/queue";
import { isLocked } from "@/core/nova/locks";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { id } = await params;
    const server = await prisma.server.findUnique({
        where: { id },
        include: {
            novaAgent: {
                include: {
                    operations: { orderBy: { startedAt: "desc" }, take: 15 },
                },
            },
        },
    });

    if (!server) return new NextResponse("Not Found", { status: 404 });
    if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
        return new NextResponse("Unauthorized", { status: 401 });
    }
    // Lectura para owner; mutaciones solo admin en POST
    const official = loadOfficialAgent();
    const a = server.novaAgent;
    return NextResponse.json({
        serverId: server.id,
        name: server.name,
        hostname: server.hostname,
        ip: server.ip,
        os: server.os,
        officialVersion: official.version,
        officialSha256: official.sha256,
        agent: a
            ? {
                installStatus: a.installStatus,
                installStatusLabel: statusLabel(a.installStatus),
                installedVersion: a.installedVersion,
                installedSha256: a.installedSha256,
                lastCheckedAt: a.lastCheckedAt,
                lastRunAt: a.lastRunAt,
                monitoringStatus: a.monitoringStatus,
                activeAlerts: a.activeAlerts,
                modules: a.modules ? JSON.parse(a.modules) : { linux: true, docker: false, plesk: false, s3: false },
                thresholds: a.thresholds ? JSON.parse(a.thresholds) : null,
                capabilities: a.capabilities ? JSON.parse(a.capabilities) : null,
                lastError: a.lastError,
                locked: isLocked(a.operationLockUntil),
                operations: a.operations.map((op) => ({
                    id: op.id,
                    type: op.type,
                    status: op.status,
                    progress: op.progress,
                    startedAt: op.startedAt,
                    finishedAt: op.finishedAt,
                    durationMs: op.durationMs,
                    stdout: op.stdout?.slice(0, 4000) || null,
                    stderr: op.stderr?.slice(0, 2000) || null,
                })),
            }
            : null,
    });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return new NextResponse("Not Found", { status: 404 });

    const body = await req.json();
    const data: { modules?: string; thresholds?: string } = {};
    if (body.modules && typeof body.modules === "object") {
        data.modules = JSON.stringify({
            linux: Boolean(body.modules.linux ?? true),
            docker: Boolean(body.modules.docker),
            plesk: Boolean(body.modules.plesk),
            s3: Boolean(body.modules.s3),
        });
    }
    if (body.thresholds && typeof body.thresholds === "object") {
        data.thresholds = JSON.stringify(body.thresholds);
    }

    await prisma.novaAgent.upsert({
        where: { serverId: id },
        update: data,
        create: { serverId: id, installStatus: "UNKNOWN", ...data },
    });

    // Push config to remote
    await enqueueNovaJob("nova-configure", {
        serverId: id,
        userId: (session.user as any).id,
    });

    await logAudit((session.user as any).id, "NOVA_CONFIGURE_SERVER", "Server", id, "Módulos/umbrales NOVA actualizados", req.headers.get("x-forwarded-for") || undefined);

    return NextResponse.json({ success: true });
}
