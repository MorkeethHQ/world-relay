import { NextRequest, NextResponse } from "next/server";
import { resolvePrediction } from "@/lib/predictions";
import { trackEvent } from "@/lib/track";

// POST { secret, outcome } — admin resolution ("VOID" refunds everyone).
// Winners split the whole pool pro-rata. Idempotent under a redis lock.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.secret || body.secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!body.outcome) return NextResponse.json({ error: "outcome required (an option or VOID)" }, { status: 400 });

  const result = await resolvePrediction(id, body.outcome);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  trackEvent("prediction_resolved", { predictionId: id }).catch(() => {});
  return NextResponse.json(result);
}
