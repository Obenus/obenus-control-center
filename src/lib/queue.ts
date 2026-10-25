import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// lazyConnect: true ensures Next.js build doesn't crash when compiling API routes
export const redisConnection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true
});

export const tasksQueue = new Queue('server-tasks', {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1,
    }
});

export type NovaJobName =
    | 'nova-install'
    | 'nova-update'
    | 'nova-reinstall'
    | 'nova-migrate'
    | 'nova-refresh'
    | 'nova-diagnose'
    | 'nova-test-telegram'
    | 'nova-configure'
    | 'nova-refresh-all'
    | 'nova-bulk-update';

export async function enqueueNovaJob(
    name: NovaJobName,
    data: Record<string, unknown>,
    opts?: { jobId?: string }
) {
    return tasksQueue.add(name, data, {
        jobId: opts?.jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
    });
}
