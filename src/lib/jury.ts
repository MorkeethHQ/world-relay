import type { Task, TaskCategory } from "./types";
import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";
import { isFunded, isRealMoney } from "./reward";

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
export const CARD_TTL_SECONDS = 2 * 3600;
/** composeDeck refuses to build when fewer than this many eligible proofs remain. */
export const JURY_COMPOSE_FLOOR = 2;

export type JuryAvailability = "deck" | "exhausted" | "empty";

export type JuryBridgeFavour = {
  id: string;
  description: string;
  category: TaskCategory;
  location: string;
  bountyUsdc: number;
  rewardType: "points";
  deadline: string;
};

/** Expressive / quick categories that produce a text-or-opinion proof without travel. */
const BRIDGE_CATEGORIES = new Set<TaskCategory>(["feedback", "review"]);
const REMOTE_LOCATION = /^(anywhere|any city|online|remote)\b/i;

export type JuryCard = {
  cardId: string;
  proofImageUrl: string; // opaque: /api/jury/card/{cardId}/image
  proofNote: string | null;
  description: string;
  category: string;
  location: string;
};

export type CardAnswer = {
  judge: string | null;
  proofTaskId: string;
  descTaskId: string;
  isMatch: boolean;
  // APPEAL cards (lib/jury-appeal.ts) ride the same opaque-card namespace so the
  // image route resolves them unchanged. They have NO knowable answer — the
  // whole point is that the humans decide — so recordJuryVerdict must refuse
  // them, or a card with no ground truth would be graded against isMatch and
  // pay a point for a coin flip.
  appeal?: boolean;
};

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

/**
 * Pure availability: distinguishes a playable deck from "you finished what was
 * available to you" (exhausted) vs "the global pool has nothing eligible"
 * (empty). The two-proof composition floor is explicit — same gate as composeDeck.
 */
export function assessJuryAvailability(
  tasks: Task[],
  judge: string | null,
  judgedProofIds: ReadonlySet<string> = new Set()
): { availability: JuryAvailability; eligibleCount: number; baseCount: number } {
  const base = juryPool(tasks, judge);
  const remaining =
    judge && judgedProofIds.size
      ? base.filter((t) => !judgedProofIds.has(t.id))
      : base;
  if (base.length < JURY_COMPOSE_FLOOR) {
    return { availability: "empty", eligibleCount: remaining.length, baseCount: base.length };
  }
  if (remaining.length < JURY_COMPOSE_FLOOR) {
    return { availability: "exhausted", eligibleCount: remaining.length, baseCount: base.length };
  }
  return { availability: "deck", eligibleCount: remaining.length, baseCount: base.length };
}

/**
 * Server-side gate for the jury → points favour return bridge.
 * Every money / campaign / travel / ownership exclusion must hold.
 */
export function isJuryBridgeEligible(task: Task, judge: string | null, allTasks: Task[] = []): boolean {
  if (task.status !== "open") return false;
  if (new Date(task.deadline).getTime() <= Date.now()) return false;
  if (task.rewardType !== "points") return false;
  if (isRealMoney(task) || isFunded(task)) return false;
  if (task.onChainId !== null || !!task.escrowTxHash) return false;
  if (task.escrowV2Address) return false;
  if (task.campaignId) return false;
  if (task.taskType === "double-or-nothing" || task.donOnChainId !== null || !!task.donStakeTxHash) {
    return false;
  }
  if (task.claimCode) return false;
  if (!BRIDGE_CATEGORIES.has(task.category)) return false;
  // No travel: remote / Anywhere-style location and no pinned coordinates.
  if (task.lat != null || task.lng != null) return false;
  if (!REMOTE_LOCATION.test((task.location || "").trim())) return false;
  // Capped: no remaining completion slots.
  const max = task.maxCompletions ?? 1;
  if ((task.completionCount || 0) >= max) return false;
  if (judge && task.poster?.toLowerCase() === judge.toLowerCase()) return false;
  // Already completed by this juror (same task id still marked completed with them).
  if (judge) {
    const j = judge.toLowerCase();
    if (
      allTasks.some(
        (t) => t.id === task.id && t.claimant?.toLowerCase() === j && t.status === "completed"
      )
    ) {
      return false;
    }
  }
  return true;
}

export function toJuryBridgeFavour(task: Task): JuryBridgeFavour {
  return {
    id: task.id,
    description: task.description,
    category: task.category,
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    rewardType: "points",
    deadline: task.deadline,
  };
}

/** At most one eligible conversion favour, stable per judge. */
export function pickJuryBridgeFavour(tasks: Task[], judge: string | null): JuryBridgeFavour | null {
  const eligible = tasks.filter((t) => isJuryBridgeEligible(t, judge, tasks));
  if (!eligible.length) return null;
  eligible.sort((a, b) => a.id.localeCompare(b.id));
  const idx = judge ? hash(judge.toLowerCase()) % eligible.length : 0;
  return toJuryBridgeFavour(eligible[idx]!);
}

// Internal pairing: returns the card content plus the (hidden) answer. Pure and
// testable; the route persists the answers and strips them before responding.
export function composeDeck(
  tasks: Task[],
  judge: string | null,
  count = JURY_DECK_SIZE
): Array<{ answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl"> }> {
  const pool = juryPool(tasks, judge);
  if (pool.length < JURY_COMPOSE_FLOOR) return [];
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

export type JuryIssueResult = {
  cards: JuryCard[];
  availability: JuryAvailability;
  bridgeFavour: JuryBridgeFavour | null;
};

async function loadJudgedProofIds(judge: string | null): Promise<Set<string>> {
  const redis = getRedis();
  if (!redis || !judge) return new Set();
  const judged = await redis.smembers(`jury:judged:${judge.toLowerCase()}`).catch(() => [] as string[]);
  return new Set((judged || []).map(String));
}

// Issue a deck: compose, persist each card's answer under an opaque id, return
// client-safe cards. randomId is injected so this stays deterministic in tests.
export async function issueJuryDeck(
  tasks: Task[],
  judge: string | null,
  randomId: () => string
): Promise<JuryCard[]> {
  const { cards } = await issueJurySession(tasks, judge, randomId);
  return cards;
}

/**
 * Full GET /api/jury payload: opaque cards + truthful availability + at most
 * one points-only bridge favour when the deck cannot be composed.
 */
export async function issueJurySession(
  tasks: Task[],
  judge: string | null,
  randomId: () => string
): Promise<JuryIssueResult> {
  const redis = getRedis();
  const judgedIds = await loadJudgedProofIds(judge);
  const { availability } = assessJuryAvailability(tasks, judge, judgedIds);

  let pool = tasks;
  if (judgedIds.size) {
    pool = tasks.filter((t) => !judgedIds.has(t.id));
  }

  const composed = availability === "deck" ? composeDeck(pool, judge) : [];
  const cards: JuryCard[] = [];
  for (const { answer, content } of composed) {
    const cardId = randomId();
    if (redis) {
      await redis.set(`jury:card:${cardId}`, JSON.stringify(answer), { ex: CARD_TTL_SECONDS }).catch(() => {});
    }
    cards.push({ cardId, proofImageUrl: `/api/jury/card/${cardId}/image`, ...content });
  }

  const bridgeFavour =
    availability === "deck" ? null : pickJuryBridgeFavour(tasks, judge);

  return { cards, availability, bridgeFavour };
}

// Shared with lib/jury-appeal.ts so appeal cards live in the same opaque
// namespace the image route already resolves.
export async function persistCardAnswer(cardId: string, answer: CardAnswer): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`jury:card:${cardId}`, JSON.stringify(answer), { ex: CARD_TTL_SECONDS }).catch(() => {});
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
  if (answer.appeal) return { error: "Appeal cards are ruled through /api/jury/appeal" };
  if (answer.judge && answer.judge.toLowerCase() !== judge.toLowerCase()) return { error: "Not your card" };

  // One verdict per card, forever (also single-use: consume the answer).
  const fresh = await redis.sadd(`jury:seen:${judge.toLowerCase()}`, cardId);
  if (!fresh) return { error: "Already judged" };
  await redis.del(`jury:card:${cardId}`).catch(() => {});
  // Record the underlying proof as judged so future decks never resurface it
  // (a proof is judged once per human, regardless of how many cards wrap it).
  await redis.sadd(`jury:judged:${judge.toLowerCase()}`, answer.proofTaskId).catch(() => {});

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
