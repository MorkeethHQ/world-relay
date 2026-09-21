import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { publishDraft } from "@/lib/campaign-drafts";
import { createTask } from "@/lib/store";

// POST /api/campaigns/drafts/<id>/publish — the company puts its own plan on the
// board as POINTS favours anyone can join. Session only, owner only, once, and one
// publish per company wallet per day. Publishing funds nothing: see
// lib/campaign-drafts.ts. The proposed pool stays a proposal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`publish:${ip}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return NextResponse.json({ error: "Sign in to publish.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to publish.", code: "wallet_required" }, { status: 403 });
  }

  const { id } = await params;
  const out = await publishDraft(owner, id, Date.now(), (input) => createTask(input));
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ campaign: out.campaign }, { status: 201 });
}
