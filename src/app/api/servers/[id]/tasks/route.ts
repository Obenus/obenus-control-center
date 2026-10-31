import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { tasksQueue } from "@/lib/queue";
import { requireServerAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        const body = await req.json();
        const taskName = typeof body.taskName === "string" ? body.taskName.trim() : "";
        if (!taskName || taskName.length > 120) {
            return NextResponse.json({ error: "Tarea inválida" }, { status: 400 });
        }

        const remoteTask = await prisma.remoteTask.findFirst({ where: { name: taskName } });
        if (!remoteTask) {
            return NextResponse.json({ error: "Tarea no autorizada" }, { status: 400 });
        }

        const job = await tasksQueue.add("execute-task", {
            serverId,
            userId: access.user.id,
            taskName,
        });

        await logAudit(
            access.user.id,
            "RUN_TASK",
            "Server",
            serverId,
            taskName,
            req.headers.get("x-forwarded-for") || undefined
        );

        return NextResponse.json({ jobId: job.id, queued: true });
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        const taskLogs = await prisma.taskLog.findMany({
            where: { serverId },
            orderBy: { startedAt: "desc" },
            take: 20,
        });

        return NextResponse.json(taskLogs);
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
