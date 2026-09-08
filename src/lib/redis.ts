import { Redis } from "@upstash/redis";
import { getMemoryRedis, memoryStoreRequested } from "./memory-redis";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    // Local demo/dev only, and only when explicitly asked for. Without this the
    // whole app runs against nothing: the board is permanently empty and the
    // only way to see the loop work is to write into the production store.
    // memoryStoreRequested() also refuses if real KV credentials are present.
    if (memoryStoreRequested()) {
      redis = getMemoryRedis() as unknown as Redis;
      return redis;
    }
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}
