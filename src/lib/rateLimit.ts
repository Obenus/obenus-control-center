/**
 * Rate limit en memoria (por proceso). Suficiente para login en instancia única.
 * Para multi-réplica, sustituir por Redis.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
    key: string,
    opts: { limit: number; windowMs: number }
): { ok: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    const cur = buckets.get(key);
    if (!cur || now >= cur.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
    }
    if (cur.count >= opts.limit) {
        return {
            ok: false,
            remaining: 0,
            retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
        };
    }
    cur.count += 1;
    return { ok: true, remaining: opts.limit - cur.count, retryAfterSec: 0 };
}

/** Limpieza ocasional para no crecer sin límite */
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
    }
}, 60_000).unref?.();
