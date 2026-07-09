import { NextRequest, NextResponse } from "next/server";
import { trackEvent, trackReach } from "@/lib/track";

export async function POST(req: NextRequest) {
  const { page, cid } = await req.json().catch(() => ({ page: "", cid: "" }));
  // Reach: count this open (deduped per device) even for anonymous visitors.
  if (typeof cid === "string" && cid) trackReach(cid).catch(() => {});
  if (!page) return NextResponse.json({ ok: true });
  trackEvent("page_view", { page }).catch(() => {});
  return NextResponse.json({ ok: true });
}
