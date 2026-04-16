import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { executeSSHCommand } from "../core/ssh/sshService";
import { fetchServerMetrics } from "../core/metrics/collector";
import { Queue } from "bullmq";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

// Tareas ahora están en Prisma RemoteTask

const worker = new Worker('server-tasks', async job => {
    if (job.name === 'collect-all-metrics') {
        const servers = await prisma.server.findMany({ where: { status: 'ACTIVE' } });
        console.log(`Starting metrics collection for ${servers.length} servers`);
        
        for (const server of servers) {
            try {
                const metrics = await fetchServerMetrics(server);
                await prisma.metricHistory.create({
                    data: {
                        serverId: server.id,
                        cpu: metrics.cpu,
                        ram: metrics.ram,
                        disk: metrics.disk
                    }
                });

                // Check Triggers
                const triggers = await prisma.serverTrigger.findMany({
                    where: { serverId: server.id, isEnabled: true }
                });

                for (const trigger of triggers) {
                    let value = trigger.metric === 'CPU' ? metrics.cpu : trigger.metric === 'RAM' ? metrics.ram : metrics.disk;
                    const isTripped = trigger.condition === 'GT' ? value > trigger.threshold : value < trigger.threshold;

                    if (isTripped) {
                        // For simplicity, we trigger immediately if condition is met in this snapshot
                        // Real logic would check last X snapshots, but we'll start with immediate reflex
                        
                        // Check cooldown (e.g. 30 mins)
                        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
                        if (!trigger.lastTriggered || trigger.lastTriggered < thirtyMinsAgo) {
                            console.log(`Trigger fired for ${server.name}: ${trigger.metric} ${trigger.condition} ${trigger.threshold}`);
                            
                            // Add task to queue
                            const q = new Queue('server-tasks', { connection: redisConnection });
                            await q.add(trigger.actionTaskName, {
                                serverId: server.id,
                                taskName: trigger.actionTaskName,
                                userId: null // System triggered
                            });

                            await prisma.serverTrigger.update({
                                where: { id: trigger.id },
                                data: { lastTriggered: new Date() }
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

    const { serverId, taskName, userId } = job.data;
    console.log(`Working on task ${taskName} for server ${serverId}`);

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new Error("Server not found");

    const remoteTask = await prisma.remoteTask.findFirst({
        where: { name: taskName }
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
        // Fallback for defaults if any triggered by older UI caches
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
        }
    });

    try {
        const { stdout, stderr, code } = await executeSSHCommand(server, command);
        const durationMs = Date.now() - startTime;

        await prisma.taskLog.update({
            where: { id: taskLog.id },
            data: {
                status: code === 0 ? "SUCCESS" : "ERROR",
                stdout,
                stderr,
                exitCode: code,
                finishedAt: new Date(),
                durationMs
            }
        });

        const statusMsg = code === 0 ? "✅ Proceso Finalizado" : "⚠️ Proceso Fallido";

        let detailedMsg = `💻 Servidor: ${server.name} (${server.ip})\n⏱️ Tiempo: ${durationMs}ms\n\n`;
        if (stdout && stdout.trim().length > 0) detailedMsg += `📝 Salida:\n${stdout.trim().slice(-1000)}\n\n`;
        if (stderr && stderr.trim().length > 0) detailedMsg += `⚠️ Errores:\n${stderr.trim().slice(-500)}\n\n`;
        detailedMsg += `${statusMsg}`;

        import("../lib/notifications").then(m => m.notifyEvent(`Tarea Remota: ${taskName}`, detailedMsg, code === 0 ? "SUCCESS" : "ERROR"));

    } catch (error: any) {
        await prisma.taskLog.update({
            where: { id: taskLog.id },
            data: {
                status: "ERROR",
                stderr: error.message || "Unknown SSH Error",
                finishedAt: new Date(),
                durationMs: Date.now() - startTime
            }
        });
        import("../lib/notifications").then(m => m.notifyEvent(`Fallo Crítico: ${taskName}`, `El servidor ${server.name} falló la conexión o ejecución.\nError: ${error.message}`, "CRITICAL"));
        throw error;
    }
}, { connection: redisConnection });

worker.on('completed', job => console.log(`Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));

console.log("BullMQ Worker started successfully listening to 'server-tasks'");

// Initialization: Setup recurring metrics collection
const setupRecurringJobs = async () => {
    const q = new Queue('server-tasks', { connection: redisConnection });
    await q.add('collect-all-metrics', {}, {
        repeat: {
            pattern: '*/5 * * * *' // Every 5 minutes
        },
        jobId: 'metrics_collector_cron'
    });
    console.log("Recurring metrics job registered (5m pattern)");
};

setupRecurringJobs();
