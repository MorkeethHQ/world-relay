import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { getRedis } from "@/lib/redis";
import { buildJuryDeck, recordJuryVerdict } from "@/lib/jury";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { trackEvent } from "@/lib/track";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/jury?address=0x... -> a deck of Real-or-Not cards for this judge.
export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address");
  const judge = address && WALLET_RE.test(address) ? address : null;
  const redis = getRedis();
  const seen = judge && redis ? new Set(((await redis.smembers(`jury:seen:${judge.toLowerCase()}`)) || []) as string[]) : new Set<string>();
  const tasks = await listTasks();
  const deck = buildJuryDeck(tasks, judge, seen);
  return NextResponse.json({ cards: deck });
}

// POST /api/jury { address, key, verdict: "match" | "not" }
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`jury:${ip}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body?.address || !WALLET_RE.test(body.address) || !body.key || !["match", "not"].includes(body.verdict)) {
    return NextResponse.json({ error: "address (wallet), key and verdict required" }, { status: 400 });
  }

  const result = await recordJuryVerdict(body.address, body.key, body.verdict === "match");
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  trackEvent("jury_verdict", { correct: result.correct }).catch(() => {});
  return NextResponse.json(result);
}
