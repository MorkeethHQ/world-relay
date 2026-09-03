import { NextRequest, NextResponse } from "next/server";
import { listTasks, getTask } from "@/lib/store";
import { getCardAnswer } from "@/lib/jury";
import { issueAppealDeck, recordAppealVote, getJudgeStats, isQualifiedJudge } from "@/lib/jury-appeal";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";
import { ownershipError } from "@/lib/session";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// THE APPEAL DECK — flagged proofs that need a human call.
//
// The graded Real-or-Not deck has a known answer and pays a point for getting
// it right. This deck has NO known answer: these are real proofs the AI could
// not clear, and the humans decide. Measured 2026-09-03: 44% of photo proofs
// were flagged, including ones the verifier itself described as "a genuine
// phone capture". See lib/jury-appeal.ts.
export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  const judge = address && WALLET_RE.test(address) ? address : null;
  const tasks = await listTasks();
  const cards = await issueAppealDeck(tasks, judge, () => crypto.randomUUID());
  const stats = judge ? await getJudgeStats(judge) : { judged: 0, correct: 0 };
  return NextResponse.json({
    cards,
    // Honest up front: an unqualified judge may still swipe, and is told their
    // call will not count rather than discovering it afterwards.
    yourCallCounts: judge ? isQualifiedJudge(stats) : false,
    yourRecord: stats,
  });
}

// POST /api/jury/appeal { address, cardId, verdict: "real" | "not" }
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`appeal:${ip}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body?.address || !WALLET_RE.test(body.address) || !body?.cardId || !["real", "not"].includes(body.verdict)) {
    return NextResponse.json({ error: "address (wallet), cardId and verdict (real|not) required" }, { status: 400 });
  }

  // A cleared appeal moves points to the CLAIMANT, so the caller must prove the
  // wallet is theirs before their vote counts toward a quorum (Inv 4).
  const ownErr = ownershipError(req, body.address, Date.now());
  if (ownErr) return NextResponse.json({ error: ownErr }, { status: 403 });

  const answer = await getCardAnswer(body.cardId);
  if (!answer || !answer.appeal) return NextResponse.json({ error: "Card expired or was never issued" }, { status: 409 });
  if (answer.judge && answer.judge.toLowerCase() !== body.address.toLowerCase()) {
    return NextResponse.json({ error: "Not your card" }, { status: 409 });
  }

  const task = await getTask(answer.proofTaskId);
  if (!task) return NextResponse.json({ error: "Proof no longer exists" }, { status: 409 });

  const result = await recordAppealVote(body.address, task, body.verdict === "real");
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  trackEvent("jury_appeal_vote", { counted: result.counted, outcome: result.outcome }).catch(() => {});
  return NextResponse.json(result);
}
