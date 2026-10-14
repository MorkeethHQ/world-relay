import { publicIdOrSame } from "@/lib/public-id";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress, isOwnSession } from "@/lib/session";
import { getReputation, getLeaderboard, getSuccessRate, getTrustScore, getMultipliedTrustScore, getMultiplierLabel, getVerificationMultiplier } from "@/lib/reputation";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  const cacheHeaders = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

  if (address) {
    // Own profile only (14 Oct 2026): with SESSION_ENFORCE off, naming any wallet
    // here returned that person's data. 401 with no session, 403 for another wallet.
    if (!isOwnSession(req, address, Date.now())) {
      const signedIn = !!getAuthedAddress(req, Date.now());
      return NextResponse.json({ error: signedIn ? "This record belongs to a different wallet." : "Re-open FAVOUR to sign in again, then this will load." , code: signedIn ? "forbidden" : "reauth_required" }, { status: signedIn ? 403 : 401, headers: { "Cache-Control": "private, no-store" } });
    }
    const rep = await getReputation(address);
    return NextResponse.json({
      ...rep,
      successRate: getSuccessRate(rep),
      trustScore: getTrustScore(rep),
      multipliedTrustScore: getMultipliedTrustScore(rep),
      multiplierLabel: getMultiplierLabel(rep.verificationLevel),
      multiplier: getVerificationMultiplier(rep.verificationLevel),
      // One person's own record: never in a shared cache (it was public, s-maxage=30).
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const leaderboard = await getLeaderboard(20);
  return NextResponse.json({
    // The list is open to anyone, so a row names a public id and never a wallet (lib/public-id.ts).
    leaderboard: leaderboard.map((rep) => ({
      ...rep,
      address: publicIdOrSame(rep.address),
      successRate: getSuccessRate(rep),
      trustScore: getTrustScore(rep),
      multipliedTrustScore: getMultipliedTrustScore(rep),
      multiplierLabel: getMultiplierLabel(rep.verificationLevel),
      multiplier: getVerificationMultiplier(rep.verificationLevel),
    })),
  }, { headers: cacheHeaders });
}
