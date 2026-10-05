import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress, ownerRefusal } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";
import { houseReviewDeck, recordHouseReviewVote } from "@/lib/house-review";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/review/flagged -> flagged proofs on house favours that this signed-in
// judge may decide (src/lib/house-review.ts). The judge is read from the session.
// A proof is sent ONLY to a qualified judge: an unqualified person gets a count
// and their own record, and no note, photo or favour text. The sender's wallet is
// never sent to anyone.
export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  const judge = address && WALLET_RE.test(address) ? address : null;
  if (!judge) return NextResponse.json({ error: "Sign in to review flagged proofs.", cards: [], yourCallCounts: false }, { status: 403 });
  const deck = await houseReviewDeck(judge);
  return NextResponse.json(
    { cards: deck.cards, waiting: deck.waiting, yourCallCounts: deck.qualified, yourRecord: deck.record },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

// POST /api/review/flagged { address, caseId, proofToken, verdict: "real" | "not", reason }
// proofToken is the one on the card that was dealt. A vote for a proof that has
// since been replaced is refused (409, code "stale") and nothing is counted.
export async function POST(req: NextRequest) {
  const { ok } = await rateLimit(`house-review:${getClientIp(req)}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body?.address || !WALLET_RE.test(body.address) || typeof body.caseId !== "string" || !["real", "not"].includes(body.verdict)) {
    return NextResponse.json({ error: "address (wallet), caseId and verdict (real|not) required" }, { status: 400 });
  }
  // A cleared review credits points to the proof's sender, so the judge must
  // prove their wallet before the vote counts (Inv 4).
  const refusal = ownerRefusal(req, body.address, Date.now());
  if (refusal) return NextResponse.json(refusal, { status: 403 });
  const result = await recordHouseReviewVote(body.address, body.caseId, body.verdict === "real", body.reason, body.proofToken);
  // A storage failure is retryable and says so; every other refusal is a 409.
  if ("error" in result) return NextResponse.json(result, { status: result.code === "retry" ? 503 : 409 });
  trackEvent("house_review_vote", { outcome: result.outcome }).catch(() => {});
  return NextResponse.json(result);
}
