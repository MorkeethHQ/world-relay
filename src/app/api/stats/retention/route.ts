import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { computeRetention } from "@/lib/retention";

// Public, read-only, cached. Exists so the ops reader (scripts/pulse.ts) can
// stay keyless: the set intersections need redis, so they run here server-side
// and the reader gets finished numbers over HTTP. No member lists ever leave
// redis, let alone this route — counts and rates only.

const CACHE_KEY = "cache:retention";
const CACHE_TTL = 600; // seconds — retention moves once a day, not per request

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis unavailable" }, { status: 503 });
  }

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const data = typeof cached === "string" ? JSON.parse(cached) : cached;
      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }
  } catch {
    // cache miss or parse error — compute fresh
  }

  try {
    const report = await computeRetention(redis, { days: 14 });
    await redis.set(CACHE_KEY, JSON.stringify(report), { ex: CACHE_TTL }).catch(() => {});
    return NextResponse.json(report, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[Retention] Failed to compute:", err);
    return NextResponse.json({ error: "Failed to compute retention" }, { status: 500 });
  }
}
