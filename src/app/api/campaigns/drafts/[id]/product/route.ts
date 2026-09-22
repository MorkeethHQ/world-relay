import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { setCampaignProduct } from "@/lib/campaign-drafts";

// POST /api/campaigns/drafts/<id>/product: a company that published before the
// product rule (2026-09-22) names its product and links it, once. Session only,
// owner only, same gate as publish. Until it does, its pieces are not offered.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`campaign-product:${ip}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return NextResponse.json({ error: "Sign in to change your campaign.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to change your campaign.", code: "wallet_required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const out = await setCampaignProduct(owner, id, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ campaign: out.campaign });
}
