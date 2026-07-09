import { NextRequest, NextResponse } from "next/server";
import { getReferralStats, REFERRAL_LIFETIME_CAP } from "@/lib/referral";

// Read-only: how many people this wallet has invited, how many activated, and
// whether the lifetime reward cap is reached. Powers the invite feedback loop
// on the dashboard (the reward machinery already existed; it was just invisible).
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
  }
  const stats = await getReferralStats(address);
  return NextResponse.json(
    { ...stats, cap: REFERRAL_LIFETIME_CAP },
    { headers: { "Cache-Control": "private, max-age=15" } }
  );
}
