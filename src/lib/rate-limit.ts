import { getRedis } from "./redis";

const localHits = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ ok: boolean; remaining: number }> {
  const redis = getRedis();

  if (redis) {
    try {
      const redisKey = `rl:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.pexpire(redisKey, windowMs);
      }
      if (count > maxRequests) {
        return { ok: false, remaining: 0 };
      }
      return { ok: true, remaining: maxRequests - count };
    } catch {
      // Fall through to local if Redis fails
    }
  }

  const now = Date.now();
  const entry = localHits.get(key);

  if (!entry || now > entry.resetAt) {
    localHits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { ok: false, remaining: 0 };
  }

  entry.count++;
  return { ok: true, remaining: maxRequests - entry.count };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
