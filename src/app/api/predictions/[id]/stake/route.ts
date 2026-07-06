import { NextRequest, NextResponse } from "next/server";
import { placeStake } from "@/lib/predictions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";
import { ownershipError } from "@/lib/session";

// POST { address, option, amount } — stake points on an outcome. Points only;
// deducted immediately, final once placed, locked at locksAt.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`pstake:${ip}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body?.address || !body.option || !body.amount) {
    return NextResponse.json({ error: "address, option and amount required" }, { status: 400 });
  }

  // A stake debits body.address's points and is final. Without this gate anyone
  // could spend another wallet's points (grief). Dormant until SESSION_ENFORCE
  // is on; logs spoof attempts meanwhile.
  const ownErr = ownershipError(req, body.address, Date.now());
  if (ownErr) return NextResponse.json({ error: ownErr }, { status: 403 });

  const result = await placeStake(id, body.address, body.option, Number(body.amount));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  trackEvent("prediction_stake", { predictionId: id, amount: Number(body.amount) }).catch(() => {});
  return NextResponse.json({ ok: true, totalPoints: Math.round(result.totalPoints ?? 0) });
}
