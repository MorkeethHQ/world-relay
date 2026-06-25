import { NextRequest, NextResponse } from "next/server";
import { trackEvent } from "@/lib/track";

export async function POST(req: NextRequest) {
  const { page } = await req.json().catch(() => ({ page: "" }));
  if (!page) return NextResponse.json({ ok: true });
  trackEvent("page_view", { page }).catch(() => {});
  return NextResponse.json({ ok: true });
}
