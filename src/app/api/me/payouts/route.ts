import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { listPayoutsFor } from "@/lib/campaign-payouts";

// GET /api/me/payouts -> the signed-in person's own piece payments, newest first:
// pending, paid or failed, each with its reason. SESSION ONLY, never ?address=.
export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  if (!address) {
    return NextResponse.json({ authenticated: false, payouts: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json(
    { authenticated: true, payouts: await listPayoutsFor(address) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
