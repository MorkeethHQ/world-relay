import type { Task } from "./types";
import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";
import { proofImagePath } from "./task-serializer";

// REAL OR NOT — the peer jury game (decision-log 2026-07-05 night).
// One-tap/swipe verdicts on proofs: "does this photo actually match this
// favour?" Half the deck shows a proof against ITS OWN task (match), half
// against a DIFFERENT task's description (mismatch) — so "Not" is genuinely
// common without needing any fake assets, and judging skill = reading proof
// specs. Points only. The jury NEVER moves money: AI verdicts stay
// authoritative for payouts (SECURITY-INVARIANTS invariant 2); this is
// engagement + human signal on top.
export const JURY_POINT_PER_CORRECT = 1;
export const JURY_DAILY_POINTS_CAP = 20; // correct verdicts that pay per day; play stays unlimited
export const JURY_DECK_SIZE = 10;

export type JuryCard = {
  key: string; // `${proofTaskId}|${descTaskId}` — match iff both ids equal
  proofImageUrl: string;
  proofNote: string | null;
  description: string;
  category: string;
  location: string;
};

// Deterministic tiny hash so deck composition is stable per task and testable.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function isMatchKey(key: string): { proofTaskId: string; descTaskId: string; isMatch: boolean } | null {
  const [proofTaskId, descTaskId] = key.split("|");
  if (!proofTaskId || !descTaskId) return null;
  return { proofTaskId, descTaskId, isMatch: proofTaskId === descTaskId };
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

export function buildJuryDeck(tasks: Task[], judge: string | null, seenKeys: Set<string>, count = JURY_DECK_SIZE): JuryCard[] {
  const pool = juryPool(tasks, judge);
  if (pool.length < 2) return [];

  const cards: JuryCard[] = [];
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    const mismatch = hash(t.id) % 2 === 1;
    // Mismatch pairs this proof with another pool task's description, offset
    // derived from the hash so the pairing is stable but varied.
    const other = mismatch ? pool[(i + 1 + (hash(t.id) % (pool.length - 1))) % pool.length] : t;
    const descTask = other.id === t.id && mismatch ? pool[(i + 1) % pool.length] : other;
    const key = `${t.id}|${descTask.id}`;
    if (seenKeys.has(key)) continue;
    cards.push({
      key,
      proofImageUrl: proofImagePath(t.id, 0),
      proofNote: t.proofNote,
      description: descTask.description,
      category: descTask.category,
      location: descTask.location,
    });
  }
  // Stable shuffle by hash so the order feels random but repeat calls agree.
  cards.sort((a, b) => hash(a.key) - hash(b.key));
  return cards.slice(0, count);
}

export type JuryVerdictResult = {
  correct: boolean;
  isMatch: boolean;
  pointsAwarded: number;
  judged: number;
  correctTotal: number;
};

export async function recordJuryVerdict(
  judge: string,
  key: string,
  saidMatch: boolean
): Promise<JuryVerdictResult | { error: string }> {
  const parsed = isMatchKey(key);
  if (!parsed) return { error: "Bad card key" };
  const redis = getRedis();
  if (!redis) return { error: "Store unavailable" };

  // One verdict per card per judge, forever.
  const fresh = await redis.sadd(`jury:seen:${judge.toLowerCase()}`, key);
  if (!fresh) return { error: "Already judged" };

  const correct = saidMatch === parsed.isMatch;

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

  return { correct, isMatch: parsed.isMatch, pointsAwarded, judged, correctTotal };
}
