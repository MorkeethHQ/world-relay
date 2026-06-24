import { NextRequest, NextResponse } from "next/server";
import { getReputation, getLeaderboard, getSuccessRate, getTrustScore, getMultipliedTrustScore, getMultiplierLabel, getVerificationMultiplier } from "@/lib/reputation";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  const cacheHeaders = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" };

  if (address) {
    const rep = await getReputation(address);
    return NextResponse.json({
      ...rep,
      successRate: getSuccessRate(rep),
      trustScore: getTrustScore(rep),
      multipliedTrustScore: getMultipliedTrustScore(rep),
      multiplierLabel: getMultiplierLabel(rep.verificationLevel),
      multiplier: getVerificationMultiplier(rep.verificationLevel),
    }, { headers: cacheHeaders });
  }

  const leaderboard = await getLeaderboard(20);
  return NextResponse.json({
    leaderboard: leaderboard.map((rep) => ({
      ...rep,
      successRate: getSuccessRate(rep),
      trustScore: getTrustScore(rep),
      multipliedTrustScore: getMultipliedTrustScore(rep),
      multiplierLabel: getMultiplierLabel(rep.verificationLevel),
      multiplier: getVerificationMultiplier(rep.verificationLevel),
    })),
  }, { headers: cacheHeaders });
}
