import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

// Public read-only funnel: arrive → start → complete.
// Counts live in redis `events:counts` (all-time) and `events:daily:YYYY-MM-DD`.
// Not cached — launch counter must reflect the latest event immediately.

function num(v: string | undefined): number {
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis unavailable" }, { status: 503 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [allTime, todayCounts] = await Promise.all([
      redis.hgetall("events:counts") as Promise<Record<string, string>>,
      redis.hgetall(`events:daily:${today}`) as Promise<Record<string, string>>,
    ]);

    return NextResponse.json(
      {
        snapshot: new Date().toISOString(),
        loop: {
          arrive: num(allTime?.loop_arrive),
          intent: num(allTime?.loop_start_intent),
          start: num(allTime?.loop_start),
          complete: num(allTime?.loop_complete),
          today: {
            arrive: num(todayCounts?.loop_arrive),
            intent: num(todayCounts?.loop_start_intent),
            start: num(todayCounts?.loop_start),
            complete: num(todayCounts?.loop_complete),
          },
        },
        howToRead:
          "Funnel: arrive → intent (tapped Start) → start (submitted proof) → complete (verified). A stranger completion is loop_complete + 1. If arrive ≫ intent, the board isn't pulling; if intent ≫ start, proof flow is losing them.",
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[Loop stats] Failed:", err);
    return NextResponse.json({ error: "Failed to compute loop stats" }, { status: 500 });
  }
}
