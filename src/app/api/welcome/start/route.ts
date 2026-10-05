import { NextRequest, NextResponse } from "next/server";
import { ownerRefusal } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { ensureWelcomeInstance } from "@/lib/welcome-journey";
import { toApiTask } from "@/lib/task-serializer";

// POST /api/welcome/start { address, sourceTaskId } -> this person's own row for
// one Welcome step. It writes at most one new row (their instance) and never
// changes the source row. The proof itself still goes to POST /api/verify-proof,
// the one check and credit path.
export async function POST(req: NextRequest) {
  const { ok } = await rateLimit(`welcome-start:${getClientIp(req)}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.address !== "string" || typeof body.sourceTaskId !== "string") {
    return NextResponse.json({ error: "address and sourceTaskId required" }, { status: 400 });
  }
  // The instance belongs to a wallet, so the wallet must be proven (Inv 4).
  const refusal = ownerRefusal(req, body.address, Date.now());
  if (refusal) return NextResponse.json(refusal, { status: 403 });
  const got = await ensureWelcomeInstance(body.sourceTaskId, body.address);
  if (!got.ok) return NextResponse.json({ error: got.error, code: got.code }, { status: got.status });
  // An internal key, never sent to a client (the same rule as detailTask).
  const { claimCode, ...task } = toApiTask(got.task);
  void claimCode;
  return NextResponse.json({ task, shared: got.shared }, { headers: { "Cache-Control": "private, no-store" } });
}
