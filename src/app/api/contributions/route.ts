import { NextRequest, NextResponse } from "next/server";
import { listContributionConsequences } from "@/lib/contribution-consequence";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * GET /api/contributions?address=0x... — personal contribution consequence chain.
 * Survives reopen (unlike filtering board tasks by claimant). Never invents rows.
 */
export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !WALLET_RE.test(address)) {
    return NextResponse.json({ error: "wallet address required" }, { status: 400 });
  }
  const limitParam = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 30;
  const contributions = await listContributionConsequences(address, limit);
  return NextResponse.json(
    { contributions },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
