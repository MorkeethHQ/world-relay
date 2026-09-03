import { NextRequest, NextResponse } from "next/server";
import { runPollRefresh } from "@/lib/poll-refresh";

// Keeps the active poll list at or above POLL_MIN_ACTIVE. See lib/poll-refresh
// for why this exists: nothing ever created a poll server-side, so on 2026-09-03
// the tab held 12 polls and none of them were still open.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runPollRefresh());
  } catch (err) {
    return NextResponse.json({ error: "poll refresh failed", detail: String(err) }, { status: 500 });
  }
}
