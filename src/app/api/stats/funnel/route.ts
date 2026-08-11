import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { computeFunnel } from "@/lib/funnel";

// Aggregate only: CIDs and individual event records never leave Redis.
export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Redis unavailable" }, { status: 503 });
  return NextResponse.json(await computeFunnel(redis, { days: 7 }), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
