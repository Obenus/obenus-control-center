import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { redisConnection, tasksQueue } from "@/lib/queue";
import { requireServerAccess } from "@/lib/access";

const CRON_RE = /^(\S+\s+){4}\S+$/;

async function ensureRedis() {
    if (redisConnection.status === "wait" || redisConnection.status === "end") {
        await redisConnection.connect().catch(() => undefined);
    }
}

/** BullMQ job.id de un repeatable: "repeat:{hash}:{millis}" */
function repeatableKeyFromJobId(jobId: string | undefined | null): string | null {
    if (!jobId) return null;
    const m = String(jobId).match(/^repeat:([^:]+):/);
    return m?.[1] || null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        const { taskName, cron } = await req.json();
        if (typeof taskName !== "string" || !taskName.trim() || taskName.length > 120) {
            return NextResponse.json({ error: "Tarea inválida" }, { status: 400 });
        }
        if (typeof cron !== "string" || !CRON_RE.test(cron.trim()) || cron.length > 80) {
            return NextResponse.json({ error: "Expresión cron inválida" }, { status: 400 });
        }

        await ensureRedis();

        const safeTask = taskName.trim();
        const safeCron = cron.trim();
        const repeatJobId = `sched_${serverId}_${safeTask.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`;

        // Quitar programación previa de la misma tarea en este servidor
        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        let schedules: any[] = existing ? JSON.parse(existing.value) : [];
        for (const old of schedules.filter((s) => s.taskName === safeTask)) {
            try {
                if (old.key) await tasksQueue.removeRepeatableByKey(old.key);
            } catch {
                /* ignore */
            }
        }
        schedules = schedules.filter((s) => s.taskName !== safeTask);

        const job = await tasksQueue.add(
            "execute-task",
            {
                serverId,
                userId: access.user.id,
                taskName: safeTask,
            },
            {
                repeat: { pattern: safeCron, jobId: repeatJobId },
            }
        );

        let key = repeatableKeyFromJobId(job.id);
        if (!key) {
            // Fallback: localizar por jobId / patrón recién creado
            const repeatables = await tasksQueue.getRepeatableJobs();
            const created =
                repeatables.find((j: any) => j.id === repeatJobId) ||
                repeatables.find(
                    (j) =>
                        j.name === "execute-task" &&
                        j.pattern === safeCron &&
                        (!schedules.some((s) => s.key === j.key))
                );
            key = created?.key || null;
        }

        if (!key) {
            return NextResponse.json(
                { error: "La tarea se encoló pero no se pudo registrar la clave de repetición" },
                { status: 500 }
            );
        }

        const repeatables = await tasksQueue.getRepeatableJobs();
        const alive = repeatables.find((r) => r.key === key);

        schedules.push({
            key,
            taskName: safeTask,
            cron: safeCron,
            repeatJobId,
            serverId,
        });
        await prisma.appConfig.upsert({
            where: { key: configKey },
            update: { value: JSON.stringify(schedules) },
            create: { key: configKey, value: JSON.stringify(schedules) },
        });

        return NextResponse.json({
            success: true,
            cron: safeCron,
            key,
            next: alive?.next || null,
        });
    } catch (e: any) {
        console.error("Schedule POST error:", e?.message || e);
        return NextResponse.json({ error: "No se pudo programar la tarea" }, { status: 500 });
    }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        await ensureRedis();

        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        const savedSchedules = existing ? JSON.parse(existing.value) : [];
        const repeatables = await tasksQueue.getRepeatableJobs();

        const merged = savedSchedules
            .map((saved: any) => {
                const alive = repeatables.find((r) => r.key === saved.key);
                if (!alive) {
                    // Mostrar igual si está en BD (Redis pudo regenerar keys); intentar por jobId
                    const byId = saved.repeatJobId
                        ? repeatables.find((r: any) => r.id === saved.repeatJobId)
                        : null;
                    if (!byId) {
                        return {
                            key: saved.key,
                            taskName: saved.taskName,
                            cron: saved.cron,
                            next: null,
                            orphan: true,
                        };
                    }
                    return {
                        key: byId.key,
                        taskName: saved.taskName,
                        cron: saved.cron,
                        next: byId.next,
                    };
                }
                return {
                    key: saved.key,
                    taskName: saved.taskName,
                    cron: saved.cron,
                    next: alive.next,
                };
            })
            .filter(Boolean);

        // Detectar jobs en Redis para este servidor que ya no están en AppConfig (fantasmas)
        const knownKeys = new Set(merged.map((s: any) => s.key).filter(Boolean));
        const delayed = await tasksQueue.getJobs(["delayed"], 0, 200);
        for (const job of delayed) {
            if (job.name !== "execute-task") continue;
            if (job.data?.serverId !== serverId) continue;
            const hash = repeatableKeyFromJobId(job.id);
            if (!hash || knownKeys.has(hash)) continue;
            const rep = repeatables.find((r) => r.key === hash);
            merged.push({
                key: hash,
                taskName: job.data?.taskName || job.name,
                cron: rep?.pattern || "—",
                next: rep?.next || null,
                ghost: true,
            });
            knownKeys.add(hash);
        }

        return NextResponse.json(merged);
    } catch (e: any) {
        console.error("Schedule GET error:", e?.message || e);
        return NextResponse.json([]);
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        await ensureRedis();

        const { key } = await req.json();
        if (typeof key !== "string" || !key || key.length > 500) {
            return NextResponse.json({ error: "Clave inválida" }, { status: 400 });
        }

        const configKey = `SCHEDULES_${serverId}`;
        const existing = await prisma.appConfig.findUnique({ where: { key: configKey } });
        const schedules = existing ? JSON.parse(existing.value) : [];
        const inConfig = schedules.some((s: any) => s.key === key);

        // Permitir borrar también jobs fantasma (en Redis pero no en AppConfig)
        let isGhostForServer = false;
        if (!inConfig) {
            const delayed = await tasksQueue.getJobs(["delayed"], 0, 200);
            isGhostForServer = delayed.some(
                (j) =>
                    j.name === "execute-task" &&
                    j.data?.serverId === serverId &&
                    repeatableKeyFromJobId(j.id) === key
            );
        }
        if (!inConfig && !isGhostForServer) {
            return NextResponse.json({ error: "Programación no encontrada" }, { status: 404 });
        }

        try {
            await tasksQueue.removeRepeatableByKey(key);
        } catch {
            /* puede no existir en Redis */
        }

        const next = schedules.filter((s: any) => s.key !== key);
        await prisma.appConfig.upsert({
            where: { key: configKey },
            update: { value: JSON.stringify(next) },
            create: { key: configKey, value: JSON.stringify(next) },
        });

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error("Schedule DELETE error:", e?.message || e);
        return NextResponse.json({ error: "No se pudo eliminar" }, { status: 500 });
    }
}
