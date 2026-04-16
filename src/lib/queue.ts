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
