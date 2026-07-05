import { NextRequest, NextResponse } from "next/server";
import { buyStreakFreeze } from "@/lib/proof-of-favour";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// Buy a streak freeze with points (the first points sink). Points-only:
// spending your own points on your own insurance needs no session gate.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`freeze:${ip}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body?.address || !WALLET_RE.test(body.address)) {
    return NextResponse.json({ error: "A valid wallet address is required" }, { status: 400 });
  }

  const result = await buyStreakFreeze(body.address);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  trackEvent("streak_freeze_bought").catch(() => {});
  return NextResponse.json({
    streakFreezes: result.profile?.streakFreezes ?? 0,
    totalPoints: Math.round(result.profile?.totalPoints ?? 0),
  });
}
