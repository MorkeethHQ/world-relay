import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { issueJuryDeck, recordJuryVerdict } from "@/lib/jury";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";
import { ownerRefusal } from "@/lib/session";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/jury?address=0x... -> a deck of opaque Real-or-Not cards. The answer
// is stored server-side per card (never sent to the client) so it can't be
// derived or fabricated (audit 2026-07-06).
export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  const judge = address && WALLET_RE.test(address) ? address : null;
  const tasks = await listTasks();
  const deck = await issueJuryDeck(tasks, judge, () => crypto.randomUUID());
  return NextResponse.json({ cards: deck });
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

  // Correct verdicts award points to body.address, so no one may farm points onto
  // (or as) another wallet. This was ownershipError, which honours SESSION_ENFORCE,
  // and that switch has shipped OFF for months: production answered an anonymous
  // verdict with 409 from the store instead of 403 from the gate. REAL OR NOT is
  // on the front door, so it is a points-writing route of this journey and the
  // check is now unconditional (see lib/session.ownerRefusal).
  const refusal = ownerRefusal(req, body.address, Date.now());
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  const result = await recordJuryVerdict(body.address, cardId, body.verdict === "match");
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  trackEvent("jury_verdict", { correct: result.correct }).catch(() => {});
  return NextResponse.json(result);
}
