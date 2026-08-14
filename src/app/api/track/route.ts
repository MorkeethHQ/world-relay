import { NextRequest, NextResponse } from "next/server";
import { trackEvent, trackReach } from "@/lib/track";

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
    trackEvent(event, data).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Reach: count this open (deduped per device) even for anonymous visitors.
  if (typeof cid === "string" && cid) trackReach(cid).catch(() => {});
  if (!page) return NextResponse.json({ ok: true });
  trackEvent("page_view", { page }).catch(() => {});
  return NextResponse.json({ ok: true });
}
