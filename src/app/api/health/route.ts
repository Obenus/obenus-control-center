import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import IORedis from "ioredis";

export const dynamic = "force-dynamic";

export async function GET() {
    const checks: Record<string, string> = {};
    let ok = true;

    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.postgres = "ok";
    } catch {
        checks.postgres = "error";
        ok = false;
    }

    try {
        const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
            lazyConnect: true,
        });
        await redis.connect();
        const pong = await redis.ping();
        checks.redis = pong === "PONG" ? "ok" : "error";
        if (pong !== "PONG") ok = false;
        await redis.quit();
    } catch {
        checks.redis = "error";
        ok = false;
    }

    return NextResponse.json(
        { status: ok ? "ok" : "degraded", checks, ts: new Date().toISOString() },
        { status: ok ? 200 : 503 }
    );
}
