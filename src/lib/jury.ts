import type { Task } from "./types";
import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";
import { DECOYS } from "./decoys";
import { gibberishReason } from "./post-quality";

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

export type JuryCard = {
  cardId: string;
  // opaque: /api/jury/card/{cardId}/image. null for a TEXT card: a real text proof,
  // or an AI-made decoy. Both kinds exist so a missing photo gives nothing away.
  proofImageUrl: string | null;
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
  // PRACTICE cards (2026-09-21, Oscar: "Real or not should be playable for
  // ever"). Dealt when a judge has used up every live proof. Same real proofs,
  // same known answer by construction, but they pay NO points and do not count
  // toward the judge's stats, so an endless game cannot be farmed.
  practice?: boolean;
  // An AI-made DECOY (lib/decoys.ts): not a task, correct call always "Not".
  // Never sent to the client before the call; revealed in the verdict.
  decoy?: boolean;
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Judgeable pool: completed, AI-passed, has a proof image, and the judge was
// neither side of it (you don't grade your own homework).
// Text proofs join the pool (2026-09-21) so that a text card is not a tell: once
// AI-made decoys exist, and decoys are text, a deck of only photos would make "no
// photo" mean "fake". A real text proof must be readable to be a fair card: 20 to 400
// characters, and neither the favour nor the note failing the same gibberish check
// POST /api/tasks applies. Photo proofs are unchanged.
export const TEXT_PROOF_MIN = 20;
export const TEXT_PROOF_MAX = 400;

function readableTextProof(t: Task): boolean {
  const note = (t.proofNote || "").trim();
  if (note.length < TEXT_PROOF_MIN || note.length > TEXT_PROOF_MAX) return false;
  return !gibberishReason(t.description) && !gibberishReason(note);
}

export function juryPool(tasks: Task[], judge: string | null): Task[] {
  return tasks.filter(
    (t) =>
      t.status === "completed" &&
      (!!t.proofImageUrl || readableTextProof(t)) &&
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
): Array<{ answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl">; hasImage: boolean }> {
  const pool = juryPool(tasks, judge);
  if (pool.length < 2) return [];
  const out: Array<{ answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl">; hasImage: boolean }> = [];
  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    const mismatch = hash(t.id) % 2 === 1;
    const other = mismatch ? pool[(i + 1 + (hash(t.id) % (pool.length - 1))) % pool.length] : t;
    const descTask = other.id === t.id && mismatch ? pool[(i + 1) % pool.length] : other;
    out.push({
      answer: { judge, proofTaskId: t.id, descTaskId: descTask.id, isMatch: t.id === descTask.id },
      content: { proofNote: t.proofNote, description: descTask.description, category: descTask.category, location: descTask.location },
      hasImage: !!t.proofImageUrl,
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
  return (await issueJuryDeckWithMode(tasks, judge, randomId)).cards;
}

// The deck, plus whether it is a PRACTICE round. A judge who has ruled on every
// live proof used to get an empty deck and a dead end. Now the same pool of REAL,
// already-verified proofs is dealt again as practice: nothing is generated or
// invented, the pairing and the hidden answer are built exactly as for a live card,
// and the answer is marked practice so recordJuryVerdict pays nothing for it.
// AT MOST this many AI-made decoys in one deck. Each decoy's right answer is "Not",
// so each one skews the deck's base rate; at 2 in 12, "Not" is right about 7 in 12.
export const DECOYS_PER_DECK = 2;

export async function issueJuryDeckWithMode(
  tasks: Task[],
  judge: string | null,
  randomId: () => string
): Promise<{ cards: JuryCard[]; practice: boolean; waiting: number }> {
  const redis = getRedis();
  // Exclude proofs this judge has already ruled on. Dedup is by TASK, not by
  // cardId: every deck mints fresh cardIds for the same proofs, so a per-cardId
  // guard alone let the same favour come back forever. jury:judged:{judge} is
  // the set of proofTaskIds already judged (written in recordJuryVerdict). Decoys
  // use their own `decoy:` id here, so a judged decoy is not dealt live again.
  let pool = tasks;
  let seen = new Set<string>();
  if (redis && judge) {
    const judged = await redis.smembers(`jury:judged:${judge.toLowerCase()}`).catch(() => [] as string[]);
    if (judged && judged.length) {
      seen = new Set(judged.map(String));
      pool = tasks.filter((t) => !seen.has(t.id));
    }
  }
  let composed = composeDeck(pool, judge);
  let practice = false;
  // How many REAL proofs are waiting for this judge. Decoys never count, so no
  // public number (the feed's "N waiting") can include one.
  const waiting = composed.length > 0 ? juryPool(pool, judge).length : 0;
  if (composed.length === 0 && judge) {
    // Live deck used up: deal a practice round from the full real pool.
    composed = composeDeck(tasks, judge);
    practice = composed.length > 0;
  }
  // A deck is never decoys alone: with no real card to deal, nothing is dealt.
  if (composed.length === 0) return { cards: [], practice: false, waiting: 0 };

  type Slot = { answer: CardAnswer; content: Omit<JuryCard, "cardId" | "proofImageUrl">; hasImage: boolean };
  const slots: Slot[] = composed.map((c) => ({ ...c, answer: practice ? { ...c.answer, practice: true } : c.answer }));

  // Splice in up to DECOYS_PER_DECK decoys: unjudged ones in a live round; any in
  // practice, where they pay nothing anyway. Positions are hashed so they are not
  // always in the same place.
  const decoyPool = practice ? DECOYS : DECOYS.filter((d) => !seen.has(d.id));
  const picks = [...decoyPool].sort((a, b) => hash(a.id + (judge ?? "")) - hash(b.id + (judge ?? ""))).slice(0, DECOYS_PER_DECK);
  for (const d of picks) {
    const at = hash(d.id + String(slots.length)) % (slots.length + 1);
    slots.splice(at, 0, {
      answer: { judge, proofTaskId: d.id, descTaskId: d.id, isMatch: false, decoy: true, ...(practice ? { practice: true } : {}) },
      content: { proofNote: d.proofNote, description: d.description, category: d.category, location: "Anywhere" },
      hasImage: false,
    });
  }

  const cards: JuryCard[] = [];
  for (const { answer, content, hasImage } of slots) {
    const cardId = randomId();
    if (redis) {
      await redis.set(`jury:card:${cardId}`, JSON.stringify(answer), { ex: CARD_TTL_SECONDS }).catch(() => {});
    }
    cards.push({ cardId, proofImageUrl: hasImage ? `/api/jury/card/${cardId}/image` : null, ...content });
  }
  return { cards, practice, waiting };
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
  practice?: boolean;
  // Revealed only AFTER the call: this card was an AI-made decoy.
  decoy?: boolean;
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

  // PRACTICE: graded so the player learns, and nothing else. No points, no daily
  // cap consumed, no stats, no judged-set write. Returned before any of those.
  if (answer.practice) {
    const statsKey = `jury:stats:${judge.toLowerCase()}`;
    const judged = Number((await redis.hget(statsKey, "judged")) || 0);
    const correctTotal = Number((await redis.hget(statsKey, "correct")) || 0);
    return { correct: saidMatch === answer.isMatch, isMatch: answer.isMatch, pointsAwarded: 0, judged, correctTotal, practice: true, ...(answer.decoy ? { decoy: true } : {}) };
  }
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

  return { correct, isMatch: answer.isMatch, pointsAwarded, judged, correctTotal, ...(answer.decoy ? { decoy: true } : {}) };
}
