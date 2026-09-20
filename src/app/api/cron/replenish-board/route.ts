import { NextRequest, NextResponse } from "next/server";
import { runReplenish, replenishEnabled } from "@/lib/board-replenish";

// The counterpart to expire-tasks. That cron only ever REMOVES supply; this one
// restores it whenever the visible open board falls below the floor. Points
// favours only — the engine cannot mint money claims (see lib/board-replenish).
//
// Idempotent and self-limiting: at or above the floor it is a no-op, and a
// stuck/doubled cron is bounded by the per-run and per-day caps.
//
// DISABLED 2026-09-16. Two changes were made together and both are deliberate:
//
//   1. The schedule was removed from vercel.json ("30 6,18 * * *"). A cron that
//      is kept on the clock only to do nothing twice a day reads as broken to
//      the next person and costs an invocation to learn nothing.
//   2. This handler is gated anyway, because removing a schedule does not make
//      an endpoint uncallable. Anyone with CRON_SECRET, a restored vercel.json,
//      or a manual curl would otherwise refill the board silently.
//
// Off therefore means: nothing is scheduled, AND a caller who arrives anyway is
// told plainly that it is off and by whose ruling, rather than receiving a
// successful-looking empty receipt. Set BOARD_REPLENISH_ENABLED=true to re-enable.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!replenishEnabled()) {
    // Logged, not silent. A disabled job that says nothing is indistinguishable
    // from a job that ran and found nothing to do, and that ambiguity is the
    // thing this change exists to remove.
    console.warn(
      "[replenish] DISABLED. Ruling 2026-09-16 (Oscar: \"Favour has a lot of stale boring items still\"). " +
        "Set BOARD_REPLENISH_ENABLED=true to re-enable."
    );
    return NextResponse.json({
      ran: false,
      disabled: true,
      reason:
        "The board replenish engine is off. It posted 24 of the 25 open favours in a single run, " +
        "none at a real place, and agent-posted favours have produced far less work than human ones.",
      ruling: "2026-09-16, Oscar",
      reenableWith: "BOARD_REPLENISH_ENABLED=true",
    });
  }

  const receipt = await runReplenish();
  return NextResponse.json(receipt);
}
