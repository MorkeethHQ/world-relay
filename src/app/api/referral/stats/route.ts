import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress, isOwnSession } from "@/lib/session";
import { getReferralStats, REFERRAL_LIFETIME_CAP } from "@/lib/referral";

// Read-only: how many people this wallet has invited, how many activated, and
// whether the lifetime reward cap is reached. Powers the invite feedback loop
// on the dashboard (the reward machinery already existed; it was just invisible).
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
  }
  // Own profile only (14 Oct 2026): with SESSION_ENFORCE off, naming any wallet
  // here returned that person's data. 401 with no session, 403 for another wallet.
  if (!isOwnSession(req, address, Date.now())) {
    const signedIn = !!getAuthedAddress(req, Date.now());
    return NextResponse.json({ error: signedIn ? "This record belongs to a different wallet." : "Re-open FAVOUR to sign in again, then this will load." , code: signedIn ? "forbidden" : "reauth_required" }, { status: signedIn ? 403 : 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const stats = await getReferralStats(address);
  return NextResponse.json(
    { ...stats, cap: REFERRAL_LIFETIME_CAP },
    { headers: { "Cache-Control": "private, max-age=15" } }
  );
}
