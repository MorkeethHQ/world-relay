import { getRedis } from "./redis";

export async function trackVisitor(address: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    redis.sadd("visitors:all", address),
    redis.sadd(`visitors:${today}`, address),
    redis.expire(`visitors:${today}`, 90 * 86400), // 90 day retention
  ]);
}
