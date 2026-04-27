import { NextRequest, NextResponse } from "next/server";
import { getProofOfFavour, getPointsToNextLevel } from "@/lib/proof-of-favour";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 }
    );
  }

  const profile = await getProofOfFavour(address);
  const nextLevel = getPointsToNextLevel(profile.totalPoints);

  return NextResponse.json({ profile, nextLevel });
}
