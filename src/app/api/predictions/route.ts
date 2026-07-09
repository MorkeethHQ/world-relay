import { NextRequest, NextResponse } from "next/server";
import { listPredictions, getStakes, poolsFrom, createPrediction, isLocked } from "@/lib/predictions";

// GET /api/predictions?address= — all predictions with pools and (if address
// given) the caller's stake. POST — admin-curated creation (ADMIN_SECRET);
// predictions are editorial for v1, not user-generated.
export async function GET(req: NextRequest) {
  const address = (new URL(req.url).searchParams.get("address") || "").toLowerCase();
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.secret || body.secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!body.question || !Array.isArray(body.options) || body.options.length < 2 || !body.locksAt) {
    return NextResponse.json({ error: "question, options (2+), locksAt required" }, { status: 400 });
  }
  const p = await createPrediction({
    question: body.question,
    options: body.options,
    locksAt: body.locksAt,
    creator: "favour",
    externalId: typeof body.externalId === "string" ? body.externalId : undefined,
  });
  return NextResponse.json({ prediction: p }, { status: 201 });
}
