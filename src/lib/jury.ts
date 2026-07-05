import type { Task } from "./types";
import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";

// REAL OR NOT — the peer jury game (decision-log 2026-07-05 night).
// One-tap/swipe verdicts on proofs: "does this photo actually match this
// favour?" Half the deck shows a proof against ITS OWN task (match), half
// against a DIFFERENT task's description (mismatch) — so "Not" is genuinely
// common without any fake assets, and judging skill = reading proof specs.
// Points only. The jury NEVER moves money: AI verdicts stay authoritative for
// payouts (SECURITY-INVARIANTS invariant 2); this is engagement + signal.
//
// SECURITY (audit 2026-07-06): the correct answer must NEVER be derivable
// client-side. Cards carry an OPAQUE cardId; the server stores the answer
// keyed by that id (jury:card:{cardId}) and resolves it only at verdict time.
// The proof image is served through the opaque card too, so the card reveals
// no task id to cross-reference against the public board.
export const JURY_POINT_PER_CORRECT = 1;
export const JURY_DAILY_POINTS_CAP = 20; // paid correct verdicts per day; play unlimited
export const JURY_DECK_SIZE = 10;
const CARD_TTL_SECONDS = 2 * 3600;

export type JuryCard = {
  cardId: string;
  proofImageUrl: string; // opaque: /api/jury/card/{cardId}/image
  proofNote: string | null;
  description: string;
  category: string;
  location: string;
};

type CardAnswer = { judge: string | null; proofTaskId: string; descTaskId: string; isMatch: boolean };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Judgeable pool: completed, AI-passed, has a proof image, and the judge was
// neither side of it (you don't grade your own homework).
export function juryPool(tasks: Task[], judge: string | null): Task[] {
  return tasks.filter(
    (t) =>
      t.status === "completed" &&
      !!t.proofImageUrl &&
      t.verificationResult?.verdict === "pass" &&
      (!judge || (t.claimant !== judge && t.poster !== judge))
  );
}

// Internal pairing: returns the card content plus the (hidden) answer. Pure and
// testable; the route persists the answers and strips them before responding.
export function composeDeck(
  tasks: Task[],
  judge: string | null,
  count = JURY_DECK_SIZE
): Array<{ answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl"> }> {
  const pool = juryPool(tasks, judge);
  if (pool.length < 2) return [];
  const out: Array<{ answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl"> }> = [];
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    const mismatch = hash(t.id) % 2 === 1;
    const other = mismatch ? pool[(i + 1 + (hash(t.id) % (pool.length - 1))) % pool.length] : t;
    const descTask = other.id === t.id && mismatch ? pool[(i + 1) % pool.length] : other;
    out.push({
      answer: { judge, proofTaskId: t.id, descTaskId: descTask.id, isMatch: t.id === descTask.id },
      content: { proofNote: t.proofNote, description: descTask.description, category: descTask.category, location: descTask.location },
    });
  }
  out.sort((a, b) => hash(a.answer.proofTaskId) - hash(b.answer.proofTaskId));
  return out.slice(0, count);
}

// Issue a deck: compose, persist each card's answer under an opaque id, return
// client-safe cards. randomId is injected so this stays deterministic in tests.
export async function issueJuryDeck(
  tasks: Task[],
  judge: string | null,
  randomId: () => string
): Promise<JuryCard[]> {
  const redis = getRedis();
  const composed = composeDeck(tasks, judge);
  const cards: JuryCard[] = [];
  for (const { answer, content } of composed) {
    const cardId = randomId();
    if (redis) {
      await redis.set(`jury:card:${cardId}`, JSON.stringify(answer), { ex: CARD_TTL_SECONDS }).catch(() => {});
    }
    cards.push({ cardId, proofImageUrl: `/api/jury/card/${cardId}/image`, ...content });
  }
  return cards;
}

export async function getCardAnswer(cardId: string): Promise<CardAnswer | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`jury:card:${cardId}`);
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as CardAnswer) : (raw as CardAnswer);
}

export type JuryVerdictResult = {
  correct: boolean;
  isMatch: boolean;
  pointsAwarded: number;
  judged: number;
  correctTotal: number;
};

// Resolves the answer SERVER-SIDE from the stored card. Rejects unknown cards
// (kills the fabricated-key faucet) and cards issued to a different judge.
export async function recordJuryVerdict(
  judge: string,
  cardId: string,
  saidMatch: boolean
): Promise<JuryVerdictResult | { error: string }> {
  const redis = getRedis();
  if (!redis) return { error: "Store unavailable" };

  const answer = await getCardAnswer(cardId);
  if (!answer) return { error: "Card expired or was never issued" };
  if (answer.judge && answer.judge.toLowerCase() !== judge.toLowerCase()) return { error: "Not your card" };

  // One verdict per card, forever (also single-use: consume the answer).
  const fresh = await redis.sadd(`jury:seen:${judge.toLowerCase()}`, cardId);
  if (!fresh) return { error: "Already judged" };
  await redis.del(`jury:card:${cardId}`).catch(() => {});

  const correct = saidMatch === answer.isMatch;

  const statsKey = `jury:stats:${judge.toLowerCase()}`;
  const judged = await redis.hincrby(statsKey, "judged", 1);
  const correctTotal = correct ? await redis.hincrby(statsKey, "correct", 1) : Number((await redis.hget(statsKey, "correct")) || 0);

  let pointsAwarded = 0;
  if (correct) {
    const day = new Date().toISOString().slice(0, 10);
    const dayKey = `jury:pts:${judge.toLowerCase()}:${day}`;
    const paidToday = await redis.incr(dayKey);
    if (paidToday === 1) await redis.expire(dayKey, 48 * 3600).catch(() => {});
    if (paidToday <= JURY_DAILY_POINTS_CAP) {
      pointsAwarded = JURY_POINT_PER_CORRECT;
      await awardPoints(judge, "jury_verdict", pointsAwarded).catch(console.error);
    }
  }

  return { correct, isMatch: answer.isMatch, pointsAwarded, judged, correctTotal };
}
