import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { acceptCampaignPiece } from "@/lib/campaign-payouts";

// POST /api/campaigns/company/<id>/accept { resultId } — the company accepts one
// reviewed piece for payment. Session only, owner only, AI-pass results only, once
// per result. Writes a PENDING payout record (or FAILED when the pool is spent).
// It never writes "paid": no route can. See lib/campaign-payouts.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`accept:${ip}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return NextResponse.json({ error: "Sign in to accept a piece.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to accept a piece.", code: "wallet_required" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { resultId?: unknown } | null;
  const resultId = typeof body?.resultId === "string" ? body.resultId : "";
  if (!resultId) return NextResponse.json({ error: "Which piece? resultId is missing." }, { status: 400 });

  const out = await acceptCampaignPiece(owner, id, resultId, Date.now());
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ payout: out.payout }, { status: out.created ? 201 : 200 });
}
