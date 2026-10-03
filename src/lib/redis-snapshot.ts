import { getRedis } from "./redis";

// Hash the exact stored bytes in the same read. Upstash may decode JSON itself;
// re-stringifying a decoded object is not an exact comparison with Redis bytes.
export async function jsonSnapshot<T>(key: string): Promise<{ value: T | null; hash: string }> {
  const redis = getRedis();
  if (!redis) throw new Error("Storage unavailable");
  const [raw, hash] = await redis.eval(
    "local v = redis.call('GET', KEYS[1]); return {v or '', v and redis.sha1hex(v) or ''}", [key], []) as [unknown, string];
  return { value: raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) as T : null, hash };
}
