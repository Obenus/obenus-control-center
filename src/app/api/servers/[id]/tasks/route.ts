import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { tasksQueue } from "@/lib/queue";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { id: serverId } = await params;
        const body = await req.json();
        const { taskName } = body;

        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        // Queue task instead of running mock
        const job = await tasksQueue.add("execute-task", {
            serverId,
            userId: (session.user as any).id,
            taskName: taskName || "Custom Command"
        });

        return NextResponse.json({ jobId: job.id, queued: true });
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { id: serverId } = await params;
        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const taskLogs = await prisma.taskLog.findMany({
            where: { serverId },
            orderBy: { startedAt: "desc" },
            take: 20
        });

        return NextResponse.json(taskLogs);
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
