import { getRedis } from "./redis";

export async function trackVisitor(address: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    redis.sadd("visitors:all", address),
    redis.sadd(`visitors:${today}`, address),
    redis.expire(`visitors:${today}`, 90 * 86400),
  ]);
}

export async function trackEvent(
  event: string,
  data?: Record<string, string | number | boolean>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const entry = JSON.stringify({ event, ts: now.toISOString(), ...data });
  await Promise.all([
    redis.lpush("events:log", entry),
    redis.ltrim("events:log", 0, 4999),
    redis.hincrby("events:counts", event, 1),
    redis.hincrby(`events:daily:${today}`, event, 1),
    redis.expire(`events:daily:${today}`, 30 * 86400),
  ]);
}
