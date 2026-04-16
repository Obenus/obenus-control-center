import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { tasksQueue } from "@/lib/queue";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { id: serverId } = await params;
        const { taskName, cron } = await req.json();

        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const job = await tasksQueue.add("execute-task", {
            serverId,
            userId: (session.user as any).id || "system",
            taskName
        }, {
            repeat: { pattern: cron }
        });

        // Save metadata to AppConfig
        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        let schedules = existing ? JSON.parse(existing.value) : [];

        // Find if BullMQ generated a key for us
        const repeatables = await tasksQueue.getRepeatableJobs();
        const createdJob = repeatables.find(j => j.pattern === cron && j.name === "execute-task");

        if (createdJob) {
            schedules.push({ key: createdJob.key, taskName, cron });
            await prisma.appConfig.upsert({
                where: { key: configKey },
                update: { value: JSON.stringify(schedules) },
                create: { key: configKey, value: JSON.stringify(schedules) }
            });
        }

        return NextResponse.json({ success: true, cron });
    } catch (e) {
        return new NextResponse("Internal", { status: 500 });
    }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });
    const { id: serverId } = await params;

    try {
        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        if (!existing) return NextResponse.json([]);

        let savedSchedules = JSON.parse(existing.value);
        const repeatables = await tasksQueue.getRepeatableJobs();

        // Merge with alive BullMQ jobs to get 'next'
        const merged = savedSchedules.map((saved: any) => {
            const alive = repeatables.find(r => r.key === saved.key);
            if (!alive) return null;
            return {
                key: saved.key,
                taskName: saved.taskName,
                cron: saved.cron,
                next: alive.next
            };
        }).filter(Boolean);

        return NextResponse.json(merged);
    } catch (e) {
        return NextResponse.json([]);
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });
    try {
        const { id: serverId } = await params;
        const { key } = await req.json();

        // Remove from BullMQ
        await tasksQueue.removeRepeatableByKey(key);

        // Remove from DB
        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        if (existing) {
            const schedules = JSON.parse(existing.value).filter((s: any) => s.key !== key);
            await prisma.appConfig.update({ where: { key: configKey }, data: { value: JSON.stringify(schedules) } });
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        return new NextResponse("Internal", { status: 500 });
    }
}
