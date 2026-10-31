import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { executeSSHCommand, REMOTE_TASK_TIMEOUT_MS, SshHostKeyError } from "../core/ssh/sshService";
import { fetchServerMetrics } from "../core/metrics/collector";
import { runNovaOperation, persistProbe, probeServerNova } from "../core/nova/novaService";
import { redactSecrets } from "../lib/novaConfig";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const METRICS_RETENTION_DAYS = Number(process.env.METRICS_RETENTION_DAYS || 30);
const TASKLOG_RETENTION_DAYS = Number(process.env.TASKLOG_RETENTION_DAYS || 90);

const NOVA_JOBS = new Set([
    "nova-install",
    "nova-update",
    "nova-reinstall",
    "nova-migrate",
    "nova-refresh",
    "nova-diagnose",
    "nova-test-telegram",
    "nova-configure",
    "nova-refresh-all",
    "nova-bulk-update",
]);

async function pruneOldData() {
    const metricsCut = new Date(Date.now() - METRICS_RETENTION_DAYS * 86400_000);
    const logsCut = new Date(Date.now() - TASKLOG_RETENTION_DAYS * 86400_000);
    await prisma.metricHistory.deleteMany({ where: { createdAt: { lt: metricsCut } } });
    await prisma.taskLog.deleteMany({ where: { startedAt: { lt: logsCut } } });
}

async function handleNovaJob(job: { name: string; data: any }) {
    if (job.name === "nova-refresh-all") {
        const servers = await prisma.server.findMany({ where: { status: "ACTIVE" } });
        console.log(`NOVA refresh-all for ${servers.length} servers`);
        for (const server of servers) {
            try {
                const probe = await probeServerNova(server);
                await persistProbe(server.id, probe);
            } catch (e: any) {
                console.error(`NOVA refresh failed for ${server.name}:`, e?.message);
            }
        }
        try {
            await pruneOldData();
        } catch (e: any) {
            console.error("prune failed:", e?.message);
        }
        return { refreshed: servers.length };
    }

    if (job.name === "nova-bulk-update") {
        const ids: string[] = Array.isArray(job.data.serverIds) ? job.data.serverIds : [];
        const results = [];
        for (const serverId of ids) {
            const server = await prisma.server.findUnique({ where: { id: serverId } });
            if (!server) {
                results.push({ serverId, error: "not_found" });
                continue;
            }
            try {
                const result = await runNovaOperation(server, "update", job.data.userId, {
                    disableLegacy: Boolean(job.data.disableLegacy),
                });
                results.push({ serverId, ok: true, operationId: result.operationId });
            } catch (e: any) {
                results.push({ serverId, ok: false, error: e?.message || "error" });
            }
        }
        return { results };
    }

    const { serverId, userId, force, disableLegacy } = job.data;
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new Error("Server not found");

    const typeMap: Record<string, any> = {
        "nova-install": "install",
        "nova-update": "update",
        "nova-reinstall": "reinstall",
        "nova-migrate": "migrate",
        "nova-refresh": "refresh",
        "nova-diagnose": "diagnose",
        "nova-test-telegram": "test_telegram",
        "nova-configure": "configure",
    };

    const opType = typeMap[job.name];
    if (!opType) throw new Error(`Unknown NOVA job ${job.name}`);

    return runNovaOperation(server, opType, userId, {
        force: Boolean(force),
        disableLegacy: Boolean(disableLegacy),
    });
}

function metricValue(
    triggerMetric: string,
    metrics: { cpu: number; ram: number; disk: number }
): number {
    if (triggerMetric === "CPU") return metrics.cpu;
    if (triggerMetric === "RAM") return metrics.ram;
    return metrics.disk;
}

function isTripped(condition: string, value: number, threshold: number): boolean {
    return condition === "GT" ? value > threshold : value < threshold;
}

const worker = new Worker(
    "server-tasks",
    async (job) => {
        if (job.name === "collect-all-metrics") {
            const servers = await prisma.server.findMany({ where: { status: "ACTIVE" } });
            console.log(`Starting metrics collection for ${servers.length} servers`);

            for (const server of servers) {
                try {
                    const metrics = await fetchServerMetrics(server);
                    await prisma.metricHistory.create({
                        data: {
                            serverId: server.id,
                            cpu: metrics.cpu,
                            ram: metrics.ram,
                            disk: metrics.disk,
                        },
                    });

                    const triggers = await prisma.serverTrigger.findMany({
                        where: { serverId: server.id, isEnabled: true },
                    });

                    for (const trigger of triggers) {
                        const value = metricValue(trigger.metric, metrics);
                        if (!isTripped(trigger.condition, value, trigger.threshold)) continue;

                        const durationMins = Math.max(1, trigger.durationMins || 5);
                        const since = new Date(Date.now() - durationMins * 60_000);
                        const samples = await prisma.metricHistory.findMany({
                            where: { serverId: server.id, createdAt: { gte: since } },
                            orderBy: { createdAt: "asc" },
                        });
                        const minSamples = Math.max(1, Math.ceil(durationMins / 5));
                        if (samples.length < minSamples) continue;
                        const sustained = samples.every((s) =>
                            isTripped(
                                trigger.condition,
                                metricValue(trigger.metric, s),
                                trigger.threshold
                            )
                        );
                        if (!sustained) continue;

                        const cooldownMs = Math.max(durationMins, 30) * 60_000;
                        const cooldownAgo = new Date(Date.now() - cooldownMs);
                        if (trigger.lastTriggered && trigger.lastTriggered > cooldownAgo) continue;

                        const remoteTask = await prisma.remoteTask.findFirst({
                            where: { name: trigger.actionTaskName },
                        });
                        if (!remoteTask) {
                            console.error(
                                `Trigger ${trigger.id}: tarea desconocida ${trigger.actionTaskName}`
                            );
                            continue;
                        }

                        console.log(
                            `Trigger fired for ${server.name}: ${trigger.metric} ${trigger.condition} ${trigger.threshold} (${durationMins}m)`
                        );

                        const q = new Queue("server-tasks", { connection: redisConnection });
                        await q.add("execute-task", {
                            serverId: server.id,
                            taskName: trigger.actionTaskName,
                            userId: null,
                        });

                        await prisma.serverTrigger.update({
                            where: { id: trigger.id },
                            data: { lastTriggered: new Date() },
                        });
                    }
                } catch (e) {
                    console.error(`Error collecting metrics for ${server.name}:`, e);
                }
            }
            return;
        }

        if (NOVA_JOBS.has(job.name)) {
            console.log(`Working on NOVA job ${job.name}`);
            return handleNovaJob(job);
        }

        const { serverId, taskName, userId } = job.data;
        if (!serverId || !taskName || typeof taskName !== "string") {
            throw new Error("Invalid job payload");
        }
        console.log(`Working on task ${taskName} for server ${serverId}`);

        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) throw new Error("Server not found");

        const remoteTask = await prisma.remoteTask.findFirst({
            where: { name: taskName },
        });
        if (!remoteTask) {
            throw new Error(`Tarea no autorizada o inexistente: ${taskName}`);
        }

        let command: string;
        try {
            const parsed = JSON.parse(remoteTask.commandTemplate);
            command = Array.isArray(parsed) ? parsed.join("\n") : String(parsed);
        } catch {
            command = remoteTask.commandTemplate;
        }

        const startTime = Date.now();
        const taskLog = await prisma.taskLog.create({
            data: {
                serverId,
                userId,
                taskName,
                status: "RUNNING",
                startedAt: new Date(startTime),
            },
        });

        try {
            const { stdout, stderr, code } = await executeSSHCommand(server, command, {
                timeoutMs: REMOTE_TASK_TIMEOUT_MS,
            });
            const durationMs = Date.now() - startTime;
            const safeOut = redactSecrets(stdout).slice(-8000);
            const safeErr = redactSecrets(stderr).slice(-4000);

            await prisma.taskLog.update({
                where: { id: taskLog.id },
                data: {
                    status: code === 0 ? "SUCCESS" : "ERROR",
                    stdout: safeOut,
                    stderr: safeErr,
                    exitCode: code,
                    finishedAt: new Date(),
                    durationMs,
                },
            });

            const ok = code === 0;
            const shouldNotify = !ok || remoteTask.notifyOnSuccess;
            if (!shouldNotify) return { ok, skippedNotify: true };

            const statusMsg = ok ? "✅ Proceso Finalizado" : "⚠️ Proceso Fallido";
            let detailedMsg = `💻 Servidor: ${server.name} (${server.ip})\n⏱️ Tiempo: ${durationMs}ms\n\n`;
            if (safeOut.trim()) detailedMsg += `📝 Salida:\n${safeOut.trim().slice(-1000)}\n\n`;
            if (safeErr.trim()) {
                detailedMsg += ok
                    ? `ℹ️ Detalle adicional:\n${safeErr.trim().slice(-500)}\n\n`
                    : `⚠️ Errores:\n${safeErr.trim().slice(-500)}\n\n`;
            }
            detailedMsg += statusMsg;

            const { notifyEvent } = await import("../lib/notifications");
            await notifyEvent(
                `Tarea Remota: ${taskName}`,
                detailedMsg,
                ok ? "SUCCESS" : "ERROR",
                { serverId }
            );
        } catch (error: any) {
            const msg = error.message || "Unknown SSH Error";
            const isTimeout = /timeout/i.test(msg);
            const isHostKey = error instanceof SshHostKeyError;
            await prisma.taskLog.update({
                where: { id: taskLog.id },
                data: {
                    status: "ERROR",
                    stderr: redactSecrets(msg).slice(0, 2000),
                    finishedAt: new Date(),
                    durationMs: Date.now() - startTime,
                },
            });
            const { notifyEvent } = await import("../lib/notifications");
            await notifyEvent(
                isTimeout ? `Timeout: ${taskName}` : isHostKey ? `Host key: ${taskName}` : `Fallo: ${taskName}`,
                isTimeout
                    ? `La tarea «${taskName}» en ${server.name} superó el tiempo máximo (${Math.round(REMOTE_TASK_TIMEOUT_MS / 60000)} min).\nDetalle: ${msg}`
                    : isHostKey
                      ? `SSH host key en ${server.name}: ${msg}. Confirma la fingerprint en la ficha del servidor.`
                      : `El servidor ${server.name} falló la conexión o ejecución.\nError: ${msg}`,
                "CRITICAL",
                { serverId }
            );
            throw error;
        }
    },
    { connection: redisConnection }
);

worker.on("completed", (job) => console.log(`Job ${job.id} completed.`));
worker.on("failed", (job, err) => console.error(`Job ${job?.id} failed:`, err));

console.log("BullMQ Worker started successfully listening to 'server-tasks'");

const setupRecurringJobs = async () => {
    const q = new Queue("server-tasks", { connection: redisConnection });
    await q.add(
        "collect-all-metrics",
        {},
        {
            repeat: { pattern: "*/5 * * * *" },
            jobId: "metrics_collector_cron",
        }
    );
    await q.add(
        "nova-refresh-all",
        {},
        {
            repeat: { pattern: "15 */6 * * *" },
            jobId: "nova_refresh_cron",
        }
    );
    console.log("Recurring metrics (5m) and NOVA refresh (6h) registered");
};

setupRecurringJobs();
