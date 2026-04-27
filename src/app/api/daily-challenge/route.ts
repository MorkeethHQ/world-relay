import { NextRequest, NextResponse } from "next/server";
import {
  getTodaysChallenge,
  hasCompletedToday,
  completeChallenge,
  getDailyChallengeStats,
  getChallengeStreak,
} from "@/lib/daily-challenge";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  try {
    const streak = address ? await getChallengeStreak(address) : 0;
    const challenge = getTodaysChallenge(streak);
    const completed = address ? await hasCompletedToday(address) : false;
    const stats = await getDailyChallengeStats();

    return NextResponse.json({
      challenge,
      completed,
      stats: { totalCompletions: stats.totalCompletions },
      streak,
    });
  } catch (err) {
    console.error("[DailyChallenge API] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch daily challenge" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, proofImageBase64, proofNote } = body;

    if (!address) {
      return NextResponse.json(
        { error: "Missing required field: address" },
        { status: 400 }
      );
    }

    if (!proofImageBase64 && !proofNote) {
      return NextResponse.json(
        { error: "At least one of proofImageBase64 or proofNote is required" },
        { status: 400 }
      );
    }

    // Check if already completed
    const alreadyDone = await hasCompletedToday(address);
    if (alreadyDone) {
      return NextResponse.json(
        { error: "Already completed today's challenge" },
        { status: 409 }
      );
    }

    const result = await completeChallenge(address, proofImageBase64, proofNote);
    const streak = await getChallengeStreak(address);

    return NextResponse.json({
      completion: {
        ...result.completion,
        proofImageBase64: undefined, // Don't echo back the full image
      },
      pointsEarned: result.pointsEarned,
      streak,
    });
  } catch (err) {
    console.error("[DailyChallenge API] POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to complete challenge";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
