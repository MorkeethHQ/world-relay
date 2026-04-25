import { NextRequest, NextResponse } from "next/server";
import { getReputation, getLeaderboard, getSuccessRate, getTrustScore, getMultipliedTrustScore, getMultiplierLabel, getVerificationMultiplier } from "@/lib/reputation";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (address) {
    const rep = await getReputation(address);
    return NextResponse.json({
      ...rep,
      successRate: getSuccessRate(rep),
      trustScore: getTrustScore(rep),
      multipliedTrustScore: getMultipliedTrustScore(rep),
      multiplierLabel: getMultiplierLabel(rep.verificationLevel),
      multiplier: getVerificationMultiplier(rep.verificationLevel),
    });
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
  });
}
