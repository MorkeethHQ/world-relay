import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress, isOwnSession } from "@/lib/session";
import { getProofOfFavour, getPointsToNextLevel } from "@/lib/proof-of-favour";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 }
    );
  }

  // Own profile only (14 Oct 2026): with SESSION_ENFORCE off, naming any wallet
  // here returned that person's data. 401 with no session, 403 for another wallet.
  if (!isOwnSession(req, address, Date.now())) {
    const signedIn = !!getAuthedAddress(req, Date.now());
    return NextResponse.json({ error: signedIn ? "This record belongs to a different wallet." : "Re-open FAVOUR to sign in again, then this will load." , code: signedIn ? "forbidden" : "reauth_required" }, { status: signedIn ? 403 : 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const profile = await getProofOfFavour(address);
  const nextLevel = getPointsToNextLevel(profile.totalPoints);

  return NextResponse.json({ profile, nextLevel }, { headers: { "Cache-Control": "private, no-store" } });
}
