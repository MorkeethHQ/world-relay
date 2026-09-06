import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { issueJurySession, recordJuryVerdict } from "@/lib/jury";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";
import { ownershipError } from "@/lib/session";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/jury?address=0x... -> opaque Real-or-Not cards + availability
// (deck | exhausted | empty) + at most one points-only bridge favour when the
// deck cannot be composed. Answers stay server-side (audit 2026-07-06).
export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  const judge = address && WALLET_RE.test(address) ? address : null;
  const tasks = await listTasks();
  const session = await issueJurySession(tasks, judge, () => crypto.randomUUID());
  return NextResponse.json({
    cards: session.cards,
    availability: session.availability,
    bridgeFavour: session.bridgeFavour,
  });
}

// POST /api/jury { address, cardId, verdict: "match" | "not" }
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`jury:${ip}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const cardId = body?.cardId || body?.key; // tolerate old clients briefly
  if (!body?.address || !WALLET_RE.test(body.address) || !cardId || !["match", "not"].includes(body.verdict)) {
    return NextResponse.json({ error: "address (wallet), cardId and verdict required" }, { status: 400 });
  }

  // Correct verdicts award points to body.address — gate so no one farms points
  // onto (or as) another wallet. Dormant until SESSION_ENFORCE is on.
  const ownErr = ownershipError(req, body.address, Date.now());
  if (ownErr) return NextResponse.json({ error: ownErr }, { status: 403 });

  const result = await recordJuryVerdict(body.address, cardId, body.verdict === "match");
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  trackEvent("jury_verdict", { correct: result.correct }).catch(() => {});
  return NextResponse.json(result);
}
