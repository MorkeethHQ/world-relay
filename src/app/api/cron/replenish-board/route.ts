import { NextRequest, NextResponse } from "next/server";
import { runReplenish } from "@/lib/board-replenish";

// The counterpart to expire-tasks. That cron only ever REMOVES supply; this one
// restores it whenever the visible open board falls below the floor. Points
// favours only — the engine cannot mint money claims (see lib/board-replenish).
//
// Idempotent and self-limiting: at or above the floor it is a no-op, and a
// stuck/doubled cron is bounded by the per-run and per-day caps.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const receipt = await runReplenish();
  return NextResponse.json(receipt);
}
