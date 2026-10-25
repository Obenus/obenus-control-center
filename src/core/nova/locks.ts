import { redisConnection } from "../../lib/queue";
import { prisma } from "../../lib/auth";

const LOCK_TTL_MS = 10 * 60 * 1000;

export async function acquireNovaLock(serverId: string, ttlMs = LOCK_TTL_MS): Promise<boolean> {
    const key = `nova:lock:${serverId}`;
    const token = `${Date.now()}`;
    try {
        if (redisConnection.status !== "ready") {
            await redisConnection.connect().catch(() => undefined);
        }
        const ok = await redisConnection.set(key, token, "PX", ttlMs, "NX");
        if (ok !== "OK") return false;
    } catch {
        // Fallback to DB lock if Redis unavailable
        const agent = await prisma.novaAgent.findUnique({ where: { serverId } });
        if (agent?.operationLockUntil && agent.operationLockUntil > new Date()) return false;
    }

    await prisma.novaAgent.upsert({
        where: { serverId },
        update: { operationLockUntil: new Date(Date.now() + ttlMs) },
        create: {
            serverId,
            installStatus: "UNKNOWN",
            operationLockUntil: new Date(Date.now() + ttlMs),
        },
    });
    return true;
}

export async function releaseNovaLock(serverId: string): Promise<void> {
    const key = `nova:lock:${serverId}`;
    try {
        await redisConnection.del(key);
    } catch {
        /* ignore */
    }
    await prisma.novaAgent.updateMany({
        where: { serverId },
        data: { operationLockUntil: null },
    });
}

export function isLocked(lockUntil: Date | null | undefined): boolean {
    return Boolean(lockUntil && lockUntil > new Date());
}
