import { NextRequest, NextResponse } from "next/server";
import { isOwnSession } from "@/lib/session";
import { listPredictions, getStakes, poolsFrom, isLocked } from "@/lib/predictions";

// GET /api/predictions?address= — all predictions with pools and (if address
// given) the caller's stake. POST — admin-curated creation (ADMIN_SECRET);
// predictions are editorial for v1, not user-generated.
export async function GET(req: NextRequest) {
  const asked = (new URL(req.url).searchParams.get("address") || "").toLowerCase();
  // Own data only (14 Oct 2026): with SESSION_ENFORCE off, naming any wallet
  // here returned that person's data. Another viewer sees no stake.
  const address = asked && isOwnSession(req, asked, Date.now()) ? asked : "";
  const now = Date.now();
  const predictions = await listPredictions();
  const out = [];
  for (const p of predictions) {
    const stakes = await getStakes(p.id);
    out.push({
      ...p,
      locked: isLocked(p, now),
      pools: poolsFrom(stakes, p.options),
      stakers: Object.keys(stakes).length,
      myStake: address ? stakes[address] || null : null,
    });
  }
  return NextResponse.json({ predictions: out });
}

export async function POST() {
  return NextResponse.json({ error: "Predictions are retired. Existing results remain available." }, { status: 410 });
}
