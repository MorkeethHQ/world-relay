import type { Task } from "./types";
import { getRedis } from "./redis";
import { awardPoints, completionPointsFor } from "./proof-of-favour";
import { isRealMoney, isFunded } from "./reward";

// JURY APPEAL — the human backstop for an AI flag.
//
// WHY THIS EXISTS (measured 2026-09-03, production):
//   text proofs   42/42 passed  — 100%
//   photo proofs  22 of 50 FLAGGED — 44%
// and the verifier's own words on flagged proofs include "the photo appears to
// be a GENUINE phone capture..." and "the photos appear to be REAL phone
// captures of flood conditions". Nearly half the people who picked up a camera
// were told their real photo needed review, after doing the work. That is the
// whole reason `photo` favours draw 0.32 completions each while `feedback`
// draws 10.17.
//
// Meanwhile REAL OR NOT — a jury of verified humans, 2,868 verdicts — was only
// ever shown proofs the AI had ALREADY passed. The one mechanism that could
// clear a wrongly-flagged photo was walled off from the only proofs that needed
// it. This module removes that wall.
//
// THE MONEY BOUNDARY IS THE POINT. See SECURITY-INVARIANTS invariant 5. A human
// quorum may clear a flag for POINTS ONLY, and only on a proof that has no
// money anywhere near it. Invariant 2 (funded USDC releases ONLY through AI
// verification) and invariant 8 (campaign progress is written ONLY by the
// verify-proof pass path) are untouched: `isAppealable` refuses every task that
// could reach either. A flagged FUNDED proof still earns nothing here — it is
// resubmitted, disputed, or expires and refunds, exactly as before.

// Distinct qualified judges required before an appeal resolves.
export const APPEAL_QUORUM = 3;
// Of those, how many must say REAL for the proof to clear.
export const APPEAL_CLEAR_MAJORITY = 2;
// A judge's vote only COUNTS once they have proven they can read a proof spec,
// on the graded Real-or-Not deck where the answer is known. The game is the
// qualification exam for the real jury — which is the one thing a bot cannot
// fake and an unverified crowd cannot provide.
export const JUDGE_MIN_GRADED = 10;
export const JUDGE_MIN_ACCURACY = 0.6;

export type AppealTally = { real: number; not: number; voters: string[]; resolved: boolean };

// ---------------------------------------------------------------------------
// PURE — the money boundary and the pool. Unit-tested without a store.
// ---------------------------------------------------------------------------

/**
 * The single gate that keeps a human verdict away from money.
 *
 * A proof is appealable ONLY if it is AI-flagged, carries an image to judge,
 * pays points, and touches no escrow, no on-chain id, no Double-or-Nothing and
 * no campaign. Every one of those exclusions maps to an invariant: money is
 * AI-verified only (Inv 2), campaign progress comes only from the pass path
 * (Inv 8), one escrow funds one payout (Inv 6).
 */
export function isAppealable(t: Task): boolean {
  return (
    t.verificationResult?.verdict === "flag" &&
    !!t.proofImageUrl &&
    !!t.claimant &&
    t.rewardType === "points" &&
    !isRealMoney(t) &&
    // isFunded, NOT hasOnChainEscrow. hasOnChainEscrow is the strict CREDIT
    // signal: it demands a real 0x+64hex tx hash, so a task carrying an
    // onChainId with no hash yet reads false — and as a refusal gate that
    // silently let an escrow-bound task through (caught by this module's guard
    // test on the first run). reward.ts says it outright: leaning loose only
    // adds protection for a gate, and is wrong only for crediting. Refuse on
    // the loosest possible signal.
    !isFunded(t) &&
    t.donOnChainId === null &&
    !t.campaignId &&
    !t.escrowV2Address
  );
}

/** Appealable proofs this judge may rule on — never their own, either side. */
export function appealPool(tasks: Task[], judge: string | null): Task[] {
  const j = judge?.toLowerCase() ?? null;
  return tasks.filter(
    (t) =>
      isAppealable(t) &&
      (!j || (t.claimant?.toLowerCase() !== j && t.poster?.toLowerCase() !== j)),
  );
}

/** Has this judge earned the right to have their appeal vote counted? */
export function isQualifiedJudge(stats: { judged: number; correct: number }): boolean {
  if (stats.judged < JUDGE_MIN_GRADED) return false;
  return stats.correct / stats.judged >= JUDGE_MIN_ACCURACY;
}

/** Given a tally, has the appeal reached quorum, and did it clear? */
export function appealOutcome(tally: Pick<AppealTally, "real" | "not">): "pending" | "cleared" | "upheld" {
  const total = tally.real + tally.not;
  if (total < APPEAL_QUORUM) return "pending";
  return tally.real >= APPEAL_CLEAR_MAJORITY ? "cleared" : "upheld";
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

const tallyKey = (taskId: string) => `appeal:tally:${taskId}`;
const votersKey = (taskId: string) => `appeal:voters:${taskId}`;
const resolvedKey = (taskId: string) => `appeal:resolved:${taskId}`;

export async function getJudgeStats(judge: string): Promise<{ judged: number; correct: number }> {
  const redis = getRedis();
  if (!redis) return { judged: 0, correct: 0 };
  const h = (await redis.hgetall(`jury:stats:${judge.toLowerCase()}`)) as Record<string, string> | null;
  return { judged: Number(h?.judged ?? 0), correct: Number(h?.correct ?? 0) };
}

export async function getAppealTally(taskId: string): Promise<AppealTally> {
  const redis = getRedis();
  if (!redis) return { real: 0, not: 0, voters: [], resolved: false };
  const [h, voters, resolved] = await Promise.all([
    redis.hgetall(tallyKey(taskId)) as Promise<Record<string, string> | null>,
    redis.smembers(votersKey(taskId)).catch(() => [] as string[]),
    redis.get(resolvedKey(taskId)),
  ]);
  return {
    real: Number(h?.real ?? 0),
    not: Number(h?.not ?? 0),
    voters: (voters || []).map(String),
    resolved: !!resolved,
  };
}

export type AppealVoteResult = {
  counted: boolean;
  reason?: string;
  outcome: "pending" | "cleared" | "upheld";
  tally: { real: number; not: number };
  pointsAwardedToClaimant?: number;
};

/**
 * Record one judge's call on a flagged proof.
 *
 * Unqualified judges may still swipe — the card is the fun — but their vote is
 * NOT counted toward quorum and cannot move anyone's points. `counted: false`
 * is an honest answer, not an error.
 */
export async function recordAppealVote(
  judge: string,
  task: Task,
  saidReal: boolean,
): Promise<AppealVoteResult | { error: string }> {
  const redis = getRedis();
  if (!redis) return { error: "Store unavailable" };
  if (!isAppealable(task)) return { error: "This proof is not appealable" };
  const j = judge.toLowerCase();
  if (task.claimant?.toLowerCase() === j || task.poster?.toLowerCase() === j) {
    return { error: "You cannot rule on your own proof" };
  }

  const already = await redis.get(resolvedKey(task.id));
  if (already) {
    const t = await getAppealTally(task.id);
    return { counted: false, reason: "Already resolved", outcome: appealOutcome(t), tally: { real: t.real, not: t.not } };
  }

  const stats = await getJudgeStats(judge);
  if (!isQualifiedJudge(stats)) {
    const t = await getAppealTally(task.id);
    return {
      counted: false,
      reason: `Judge ${Math.min(JUDGE_MIN_GRADED, stats.judged)}/${JUDGE_MIN_GRADED} graded cards at ${Math.round(JUDGE_MIN_ACCURACY * 100)}% to have your call counted`,
      outcome: appealOutcome(t),
      tally: { real: t.real, not: t.not },
    };
  }

  // One vote per judge per proof. SADD is the atomic dedup, same guard the poll
  // and graded-jury paths use.
  const fresh = await redis.sadd(votersKey(task.id), j);
  if (!fresh) {
    const t = await getAppealTally(task.id);
    return { counted: false, reason: "Already ruled", outcome: appealOutcome(t), tally: { real: t.real, not: t.not } };
  }

  await redis.hincrby(tallyKey(task.id), saidReal ? "real" : "not", 1);
  const tally = await getAppealTally(task.id);
  const outcome = appealOutcome(tally);

  let pointsAwardedToClaimant: number | undefined;
  if (outcome !== "pending") {
    // Reserve the resolution BEFORE awarding, so two judges landing the quorum
    // vote concurrently cannot both pay the claimant.
    const claimed = await redis.set(resolvedKey(task.id), outcome, { nx: true, ex: 90 * 86400 });
    if (claimed) {
      if (outcome === "cleared" && task.claimant) {
        const pts = completionPointsFor(task.rewardType, task.bountyUsdc);
        if (pts > 0) {
          await awardPoints(task.claimant, "jury_appeal_cleared", pts).catch(console.error);
          pointsAwardedToClaimant = pts;
        }
      }
    }
  }

  return { counted: true, outcome, tally: { real: tally.real, not: tally.not }, pointsAwardedToClaimant };
}

/**
 * Issue opaque appeal cards. They share the graded deck's card namespace so the
 * existing image route resolves them with no change, but carry `appeal: true`
 * so the graded verdict path refuses to score them.
 */
export async function issueAppealDeck(
  tasks: Task[],
  judge: string | null,
  randomId: () => string,
  count = 5,
): Promise<Array<{ cardId: string; proofImageUrl: string; proofNote: string | null; description: string; category: string; location: string; tally: { real: number; not: number } }>> {
  const { persistCardAnswer } = await import("./jury");
  const redis = getRedis();
  let pool = appealPool(tasks, judge);
  if (redis && judge) {
    // A judge rules on a given proof once, ever.
    const voted = await Promise.all(
      pool.map(async (t) => ((await redis.sismember(votersKey(t.id), judge.toLowerCase())) ? t.id : null)),
    );
    const seen = new Set(voted.filter(Boolean) as string[]);
    pool = pool.filter((t) => !seen.has(t.id));
  }
  const out = [];
  for (const t of pool.slice(0, count)) {
    const cardId = randomId();
    await persistCardAnswer(cardId, { judge, proofTaskId: t.id, descTaskId: t.id, isMatch: true, appeal: true });
    const tally = await getAppealTally(t.id);
    out.push({
      cardId,
      proofImageUrl: `/api/jury/card/${cardId}/image`,
      proofNote: t.proofNote ?? null,
      description: t.description,
      category: t.category,
      location: t.location,
      tally: { real: tally.real, not: tally.not },
    });
  }
  return out;
}
