import { NextResponse } from "next/server";
import { getRecentEvents } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public liveness feed for the board's activity strip. Sourced ONLY from real
// logged SSE events (sse:events in Redis) — never synthesized (no fake data,
// ever). We expose the action, the place, and the time. We deliberately do NOT
// expose reward amounts (the event payload's bountyUsdc can't tell points from
// USDC, and the two are never conflated) or identities.
const LABELS: Partial<Record<string, string>> = {
  "task:created": "New favour posted",
  "task:claimed": "A favour was picked up",
  "task:verified": "A favour was completed", // only when it passed — see filter
  "task:completed": "A favour was completed",
  "task:settled": "A favour paid out",
};

export async function GET() {
  const events = await getRecentEvents(0); // every stored event (ts is always > 0)
  const items = events
    .filter((e) => {
      if (!LABELS[e.type]) return false;
      // task:verified fires for pass, fail, and flag (dispute/escalate too).
      // Only a passing verdict is a real completion worth celebrating.
      if (e.type === "task:verified" && e.data.verdict !== "pass") return false;
      return true;
    })
    .map((e) => ({
      type: e.type,
      label: LABELS[e.type]!,
      location: e.data.location || null,
      ts: e.ts,
    }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
