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
  // High-frequency events keep their counters but stay OUT of the capped log:
  // ~6k feed_loaded entries were churning per-user funnel history out of the
  // 5000-entry window within days.
  const HIGH_FREQUENCY = event === "feed_loaded" || event === "page_view";
  await Promise.all([
    ...(HIGH_FREQUENCY ? [] : [redis.lpush("events:log", entry), redis.ltrim("events:log", 0, 4999)]),
    redis.hincrby("events:counts", event, 1),
    redis.hincrby(`events:daily:${today}`, event, 1),
    redis.expire(`events:daily:${today}`, 30 * 86400),
  ]);
}
