import { Worker, Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { executeSSHCommand, REMOTE_TASK_TIMEOUT_MS } from "../core/ssh/sshService";
import { fetchServerMetrics } from "../core/metrics/collector";
import { runNovaOperation, persistProbe, probeServerNova } from "../core/nova/novaService";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

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

    return runNovaOperation(server, opType, userId, { force: Boolean(force), disableLegacy: Boolean(disableLegacy) });
}

const worker = new Worker("server-tasks", async (job) => {
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
                    const value =
                        trigger.metric === "CPU"
                            ? metrics.cpu
                            : trigger.metric === "RAM"
                                ? metrics.ram
                                : metrics.disk;
                    const isTripped =
                        trigger.condition === "GT" ? value > trigger.threshold : value < trigger.threshold;

                    if (isTripped) {
                        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
                        if (!trigger.lastTriggered || trigger.lastTriggered < thirtyMinsAgo) {
                            console.log(
                                `Trigger fired for ${server.name}: ${trigger.metric} ${trigger.condition} ${trigger.threshold}`
                            );

                            const q = new Queue("server-tasks", { connection: redisConnection });
                            await q.add(trigger.actionTaskName, {
                                serverId: server.id,
                                taskName: trigger.actionTaskName,
                                userId: null,
                            });

                            await prisma.serverTrigger.update({
                                where: { id: trigger.id },
                                data: { lastTriggered: new Date() },
                            });
                        }
                    }
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
    console.log(`Working on task ${taskName} for server ${serverId}`);

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new Error("Server not found");

    const remoteTask = await prisma.remoteTask.findFirst({
        where: { name: taskName },
    });

    let command = "echo 'No command template found'";

    if (remoteTask) {
        try {
            const parsed = JSON.parse(remoteTask.commandTemplate);
            command = Array.isArray(parsed) ? parsed.join("\n") : String(parsed);
        } catch {
            command = remoteTask.commandTemplate;
        }
    } else {
        if (taskName === "Apt Update & Upgrade") command = "apt-get update -y";
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

        await prisma.taskLog.update({
            where: { id: taskLog.id },
            data: {
                status: code === 0 ? "SUCCESS" : "ERROR",
                stdout,
                stderr,
                exitCode: code,
                finishedAt: new Date(),
                durationMs,
            },
        });

        const ok = code === 0;
        const statusMsg = ok ? "✅ Proceso Finalizado" : "⚠️ Proceso Fallido";

        // Muchas herramientas Linux (journalctl, apt…) escriben progreso en stderr
        // aunque el comando sea correcto; no etiquetar eso como "Errores".
        let detailedMsg = `💻 Servidor: ${server.name} (${server.ip})\n⏱️ Tiempo: ${durationMs}ms\n\n`;
        if (stdout && stdout.trim().length > 0) {
            detailedMsg += `📝 Salida:\n${stdout.trim().slice(-1000)}\n\n`;
        }
        if (stderr && stderr.trim().length > 0) {
            detailedMsg += ok
                ? `ℹ️ Detalle adicional:\n${stderr.trim().slice(-500)}\n\n`
                : `⚠️ Errores:\n${stderr.trim().slice(-500)}\n\n`;
        }
        detailedMsg += `${statusMsg}`;

        import("../lib/notifications").then((m) =>
            m.notifyEvent(`Tarea Remota: ${taskName}`, detailedMsg, ok ? "SUCCESS" : "ERROR")
        );
    } catch (error: any) {
        const msg = error.message || "Unknown SSH Error";
        const isTimeout = /timeout/i.test(msg);
        await prisma.taskLog.update({
            where: { id: taskLog.id },
            data: {
                status: "ERROR",
                stderr: msg,
                finishedAt: new Date(),
                durationMs: Date.now() - startTime,
            },
        });
        import("../lib/notifications").then((m) =>
            m.notifyEvent(
                isTimeout ? `Timeout: ${taskName}` : `Fallo: ${taskName}`,
                isTimeout
                    ? `La tarea «${taskName}» en ${server.name} superó el tiempo máximo (${Math.round(REMOTE_TASK_TIMEOUT_MS / 60000)} min).\nEl servidor puede estar bien; la operación era demasiado larga o quedó colgada.\nDetalle: ${msg}`
                    : `El servidor ${server.name} falló la conexión o ejecución.\nError: ${msg}`,
                "CRITICAL"
            )
        );
        throw error;
    }
}, { connection: redisConnection });

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
