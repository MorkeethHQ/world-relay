import { NextRequest, NextResponse } from "next/server";
import { trackEvent, trackReach } from "@/lib/track";
import { FUNNEL_EVENTS } from "@/lib/funnel-events";

// This route is PUBLIC and unauthenticated, and trackEvent writes the event name
// straight into a redis hash field (`events:counts`). So the name is an allowlist,
// never caller-supplied text: otherwise anyone could mint unbounded fields, bury the
// real funnel, and churn the capped events:log. Add a name here deliberately.
const CLIENT_EVENTS = new Set([
  "fund_wall_hit",
  "usdc_post_attempt",
  "world_app_handoff_clicked",
  "world_app_deep_link_opened",
  "task_share_opened",
  "invite_share_opened",
  "loop_arrive",
  "loop_start_intent",
  // The first-visit funnel (2026-09-21). One source of truth for the names, so a
  // step cannot be fired by the client and silently dropped here.
  ...FUNNEL_EVENTS,
]);

// Numbers only, finite, clamped. Keeps a hostile caller from writing an essay into
// the log entry or poisoning the funnel.
//
// Must reject on TYPE, not coerce: JSON.stringify turns Infinity and NaN into `null`,
// and `Number(null)` is 0 — so a coercing version silently recorded hostile or absent
// values as a real-looking $0.00 instead of dropping them. A zero that means "no data"
// is indistinguishable from a zero that means "empty wallet", which is precisely the
// distinction this funnel exists to make. Caught by its own guard test.
function safeNumber(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.round(Math.min(Math.max(v, 0), 1_000_000) * 100) / 100;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { page, cid, event } = body ?? {};

  // Named client events (the funding funnel). Checked before the page_view path so
  // a tracked event never also counts as a page view.
  if (typeof event === "string" && CLIENT_EVENTS.has(event)) {
    const data: Record<string, number> = {};
    const needed = safeNumber(body?.data?.needed);
    const balance = safeNumber(body?.data?.balance);
    if (needed !== undefined) data.needed = needed;
    if (balance !== undefined) data.balance = balance;
    // AWAITED (2026-09-22). This used to fire and forget, then answer. On Vercel a
    // function can be frozen as soon as it has answered, so the write was lost: two
    // production walks at 07:18Z and 07:23Z sent 13 funnel events, every POST got
    // 200 in the function log, and not one reached events:daily. A beacon that
    // answers before it records is a counter that says yes and counts nothing.
    await trackEvent(event, data).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // An event name that is not on the list is REFUSED, not waved through. Before
  // 2026-09-21 it fell through to the page-view path and answered 200, so a typo in
  // a client event looked exactly like success while recording nothing. A refusal
  // is the only way a misspelled funnel step shows up before the numbers do.
  if (typeof event === "string") {
    return NextResponse.json({ error: "unknown event" }, { status: 400 });
  }

  // Reach: count this open (deduped per device) even for anonymous visitors.
  if (typeof cid === "string" && cid) await trackReach(cid).catch(() => {});
  if (!page) return NextResponse.json({ ok: true });
  await trackEvent("page_view", { page }).catch(() => {});
  return NextResponse.json({ ok: true });
}
