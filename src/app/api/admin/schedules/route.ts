import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { requireAdmin } from "@/lib/access";
import { tasksQueue, redisConnection } from "@/lib/queue";

function repeatableKeyFromJobId(jobId: string | undefined | null): string | null {
    if (!jobId) return null;
    const m = String(jobId).match(/^repeat:([^:]+):/);
    return m?.[1] || null;
}

export async function GET() {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    if (redisConnection.status === "wait" || redisConnection.status === "end") {
        await redisConnection.connect().catch(() => undefined);
    }

    const servers = await prisma.server.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
    const byId = Object.fromEntries(servers.map((s) => [s.id, s.name]));

    const configs = await prisma.appConfig.findMany({
        where: { key: { startsWith: "SCHEDULES_" } },
    });

    const fromConfig: any[] = [];
    const knownKeys = new Set<string>();
    for (const c of configs) {
        const serverId = c.key.replace(/^SCHEDULES_/, "");
        let list: any[] = [];
        try {
            list = JSON.parse(c.value);
        } catch {
            list = [];
        }
        for (const s of list) {
            if (s.key) knownKeys.add(s.key);
            fromConfig.push({
                serverId,
                serverName: byId[serverId] || serverId,
                taskName: s.taskName,
                cron: s.cron,
                key: s.key,
                source: "config",
                orphan: false,
                ghost: false,
            });
        }
    }

    const repeatables = await tasksQueue.getRepeatableJobs();
    const delayed = await tasksQueue.getJobs(["delayed"], 0, 300);
    const dataByHash: Record<string, any> = {};
    for (const j of delayed) {
        if (j.name !== "execute-task") continue;
        const hash = repeatableKeyFromJobId(j.id);
        if (hash && !dataByHash[hash]) dataByHash[hash] = j.data;
    }

    const ghosts: any[] = [];
    for (const r of repeatables) {
        if (r.name !== "execute-task") continue;
        if (knownKeys.has(r.key)) {
            const row = fromConfig.find((x) => x.key === r.key);
            if (row) {
                row.next = r.next || null;
                row.alive = true;
            }
            continue;
        }
        const data = dataByHash[r.key] || {};
        ghosts.push({
            serverId: data.serverId || null,
            serverName: data.serverId ? byId[data.serverId] || data.serverId : "(desconocido)",
            taskName: data.taskName || "?",
            cron: r.pattern,
            key: r.key,
            next: r.next || null,
            source: "redis",
            ghost: true,
            orphan: false,
            alive: true,
        });
    }

    for (const row of fromConfig) {
        if (row.alive === undefined) {
            row.orphan = true;
            row.next = null;
        }
    }

    return NextResponse.json({
        schedules: [...fromConfig, ...ghosts].sort((a, b) =>
            String(a.serverName).localeCompare(String(b.serverName))
        ),
    });
}
