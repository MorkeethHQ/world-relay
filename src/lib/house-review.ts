// HUMAN REVIEW OF A FLAGGED PROOF ON A HOUSE FAVOUR (2026-10-05).
//
// WHY. The proof screen said "Waiting for a human check" on proofs no person
// could open: the poster was a house agent, and the photo appeal
// (jury-appeal.ts) refuses every campaign favour and every written answer. On
// 5 Oct 2026 the public board held 8 Welcome favours and 28 plain written
// answers that way. Which proofs this covers is decided by one pure gate,
// houseReviewScope (house-review-gate.ts). Read that file for what is refused.
//
// WHO DECIDES. The same people the photo appeal trusts: a judge with 10 graded
// Real or Not cards at 60% (isQualifiedJudge), signed in with their own wallet,
// never on their own proof. Three distinct judges, two must accept. Each gives a
// written reason. Only a qualified judge is shown a flagged proof at all: a
// Welcome instance is private to its owner, and the reviewers are the only other
// people who read it.
//
// WHAT A DECISION DOES. Points only, the favour's own value, once.
//   - Invariant 2: nothing with money on it passes the gate, and this file has
//     no call that moves money.
//   - Invariant 8: this file never calls recordCampaignCompletion, and the only
//     campaign the gate admits is Welcome while it has no cash unlock.
//
// THE ORDER AT RESOLUTION, and why (two reviews on 5 Oct 2026).
// First finding: the resolution was reserved and the case dropped from the
// queue BEFORE the completion slot was taken, so a store that could not answer
// left a proof cleared and completed with no points, for good.
// Second finding, shown on a real Redis: the slot (SADD) and the note that this
// case took it were two commands. When the SADD landed and its response was
// lost, the retry read the slot as someone else's and cleared with 0 points.
// A write whose answer never arrives must be recognisable as your own.
//   1. THE SLOT AND ITS MARKER, one script (CLAIM_SLOT_FOR_CASE). The marker is
//      keyed by the case, so a retry reads back what THIS case did.
//   2. THE CREDIT, one compare-and-set script, keyed by the case
//      (creditCompletionStrict): a strict read, never the display fallback, and
//      the ref saved in the same write as the points.
//   3. THE HISTORY ROW AND ITS MARKER, one script (RECORD_HISTORY_ONCE).
//   4. the favour's own row.
//   5. only then the resolution marker, and the case leaves the queue.
// Any failure, before or after a write landed, answers "not confirmed, safe to
// try again". Every step run again changes nothing it already did. Once three
// votes are in, no further vote is taken: the same tally is finished by whoever
// calls next, the last judge included.
import { createHash } from "crypto";
import type { Task } from "./types";
import { getRedis } from "./redis";
import { getTask, listTasks, saveWelcomeInstance, posterConfirm } from "./store";
import { completionPointsFor, creditCompletionStrict } from "./proof-of-favour";
import { buildContribution, completedClaimantsKey, contributionsKey, CONTRIBUTIONS_MAX } from "./completions";
import { appealOutcome, getJudgeStats, isQualifiedJudge } from "./jury-appeal";
import { APPEAL_QUORUM, JUDGE_MIN_ACCURACY, JUDGE_MIN_GRADED } from "./jury-appeal-rules";
import { houseReviewScope, type HouseReviewScope } from "./house-review-gate";

export const HOUSE_REVIEW_QUEUE = "house:review:queue";
export const REVIEW_REASON_MIN = 20;
export const REVIEW_REASON_MAX = 1000;

// A case is one exact proof on one favour by one person. A new proof is a new
// case, and votes on the old proof do not carry over. Rows saved before
// proofSubmissionId existed are bound by their content instead.
export function houseCaseKey(t: Pick<Task, "id" | "claimant" | "proofSubmissionId" | "proofImageUrl" | "proofImages" | "proofNote">): string {
  const proof = createHash("sha256")
    .update(JSON.stringify([t.proofSubmissionId ?? null, t.claimant?.toLowerCase() ?? null, t.proofImageUrl ?? null, t.proofImages ?? null, t.proofNote ?? null]))
    .digest("hex")
    .slice(0, 24);
  return `${t.id}:${proof}`;
}
// THE PROOF TOKEN (2026-10-05). A card names the favour, and the favour's proof
// can change while a reviewer reads it: the sender may send a new one. The vote
// then landed on a proof the reviewer never saw. Each dealt card now carries
// this token, the vote must send it back, and it is compared with the CURRENT
// proof under the verify lock before anything is counted. It is the hashed half
// of the case key: no wallet and no proof text can be read out of it.
export function houseProofToken(t: Pick<Task, "id" | "claimant" | "proofSubmissionId" | "proofImageUrl" | "proofImages" | "proofNote">): string {
  return houseCaseKey(t).slice(t.id.length + 1);
}
const tallyKey = (c: string) => `house:review:tally:${c}`;
const votersKey = (c: string) => `house:review:voters:${c}`;
const reasonsKey = (c: string) => `house:review:reasons:${c}`;
const resolvedKey = (c: string) => `house:review:resolved:${c}`;
const slotKey = (c: string) => `house:review:slot:${c}`;
const historyKey = (c: string) => `house:review:history:${c}`;
const creditRef = (c: string) => `house-review:${c}`;

// Called from verify-proof when a proof is flagged. It writes no verdict and no
// credit: it only puts a private Welcome instance where a reviewer can find it.
// Shared rows need no queue; the deck finds them in the task list.
export async function queueHouseReview(t: Task): Promise<boolean> {
  const redis = getRedis();
  if (!redis || houseReviewScope(t) === null) return false;
  await redis.sadd(HOUSE_REVIEW_QUEUE, t.id);
  return true;
}

async function tallyOf(c: string): Promise<{ real: number; not: number }> {
  const redis = getRedis();
  if (!redis) return { real: 0, not: 0 };
  const h = (await redis.hgetall(tallyKey(c))) as Record<string, string> | null;
  return { real: Number(h?.real ?? 0), not: Number(h?.not ?? 0) };
}

// Every flagged proof that passes the gate: queued private instances, and shared
// rows (which include the proofs held from before this review existed).
async function reviewableTasks(now: number): Promise<Task[]> {
  const redis = getRedis();
  if (!redis) return [];
  const queued = (await redis.smembers(HOUSE_REVIEW_QUEUE)).map(String);
  const fromQueue = (await Promise.all(queued.map((id) => getTask(id)))).filter((t): t is Task => !!t);
  const shared = await listTasks();
  const seen = new Set<string>();
  return [...fromQueue, ...shared].filter((t) => {
    if (seen.has(t.id) || houseReviewScope(t, now) === null) return false;
    seen.add(t.id);
    return true;
  });
}

export type HouseReviewCard = {
  caseId: string; // the favour's id, never the sender's wallet
  proofToken: string; // binds a vote to the exact proof this card showed
  scope: HouseReviewScope;
  description: string;
  category: string;
  points: number;
  proofNote: string | null;
  images: string[];
  aiReason: string;
  tally: { real: number; not: number };
};

export type HouseReviewDeck = { qualified: boolean; record: { judged: number; correct: number }; waiting: number; cards: HouseReviewCard[] };

// What one signed-in person sees. An UNQUALIFIED person gets the count and their
// own record, and no proof: not a note, not a photo, not what was asked of whom.
// The limit is high enough for a reviewer to reach every proof that waits by
// stepping through the deck (the review page lets them pass a proof without
// voting). At 5, eight old held Welcome proofs hid everything behind them.
export const HOUSE_REVIEW_DECK_MAX = 40;
export async function houseReviewDeck(judge: string, limit = HOUSE_REVIEW_DECK_MAX, now: number = Date.now()): Promise<HouseReviewDeck> {
  const redis = getRedis();
  const j = judge.toLowerCase();
  const record = await getJudgeStats(j);
  const qualified = isQualifiedJudge(record);
  if (!redis) return { qualified, record, waiting: 0, cards: [] };
  const mine: Array<{ t: Task; c: string }> = [];
  for (const t of await reviewableTasks(now)) {
    if (t.claimant?.toLowerCase() === j) continue;
    const c = houseCaseKey(t);
    if (await redis.get(resolvedKey(c))) continue;
    if (await redis.sismember(votersKey(c), j)) continue;
    mine.push({ t, c });
  }
  if (!qualified) return { qualified, record, waiting: mine.length, cards: [] };
  const cards: HouseReviewCard[] = [];
  for (const { t, c } of mine.slice(0, limit)) {
    cards.push({
      caseId: t.id,
      proofToken: houseProofToken(t),
      scope: houseReviewScope(t, now)!,
      description: t.description,
      category: t.category,
      points: completionPointsFor(t.rewardType, t.bountyUsdc),
      proofNote: t.proofNote,
      images: (t.proofImages?.length ? t.proofImages : t.proofImageUrl ? [t.proofImageUrl] : []).slice(0, 3),
      aiReason: String(t.verificationResult?.reasoning ?? "").split(" | ")[0].slice(0, 280),
      tally: await tallyOf(c),
    });
  }
  return { qualified, record, waiting: mine.length, cards };
}

// A count for the one review entry on the board. No proof data.
export async function houseReviewWaiting(now: number = Date.now()): Promise<number> {
  return (await reviewableTasks(now)).length;
}

export type HouseReviewResult =
  | { error: string; code?: "retry" | "stale" }
  | { counted: boolean; outcome: "pending" | "cleared" | "upheld"; tally: { real: number; not: number }; pointsAwardedToClaimant?: number };

// Said without claiming that nothing was written: an earlier step may already
// have landed, and the retry is safe exactly because each step knows its own work.
const RETRY = { error: "The decision was not confirmed. It is safe to try again: anything already saved is kept, and no extra credit can be added.", code: "retry" as const };

const MARKER_TTL = 90 * 86400;

// The person's completion slot and the case's own record of it, in ONE
// operation. Answers "credit" when this case took the slot (now or on an
// earlier call whose answer was lost) and "none" when someone else's pass
// already held it.
export const CLAIM_SLOT_FOR_CASE = `-- favour:case-slot
local mine = redis.call('GET', KEYS[2])
if mine then return mine end
local added = redis.call('SADD', KEYS[1], ARGV[1])
local result = 'none'
if added == 1 then result = 'credit' end
redis.call('SET', KEYS[2], result, 'EX', tonumber(ARGV[2]))
return result`;

// The History row and the marker that says it was written, in ONE operation, so
// a marker can never exist without its row.
export const RECORD_HISTORY_ONCE = `-- favour:case-history
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[4])) then
  redis.call('LPUSH', KEYS[2], ARGV[2])
  redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[3]) - 1)
  return 1
end
return 0`;

export async function recordHouseReviewVote(
  judge: string,
  taskId: string,
  real: boolean,
  reason: unknown,
  // The token from the card the reviewer was shown (houseProofToken).
  proofToken: unknown,
  now: number = Date.now(),
): Promise<HouseReviewResult> {
  const redis = getRedis();
  if (!redis) return { error: "Review storage unavailable" };
  const j = judge.toLowerCase();
  if (!isQualifiedJudge(await getJudgeStats(j))) {
    return { error: `Complete ${JUDGE_MIN_GRADED} graded cards at ${Math.round(JUDGE_MIN_ACCURACY * 100)}% accuracy before reviewing flagged work.` };
  }
  // The same lock verify-proof takes, so a new proof cannot land mid-vote.
  const lock = `lock:verify:${taskId}`;
  const token = `review:${j}:${now}`;
  if (!(await redis.set(lock, token, { nx: true, px: 60000 }))) return { error: "Proof is being updated. Try again." };
  try {
    const t = await getTask(taskId);
    const scope = t ? houseReviewScope(t, now) : null;
    if (!t || !scope) return { error: "This proof is not waiting for review." };
    if (t.claimant!.toLowerCase() === j || t.poster?.toLowerCase() === j) return { error: "You cannot review your own proof." };
    const c = houseCaseKey(t);
    // The decision must be about the proof that is on the favour NOW. A missing
    // or old token is refused here, under the lock, before any vote is counted
    // and before any resolution step runs.
    if (typeof proofToken !== "string" || proofToken.length === 0 || proofToken !== houseProofToken(t)) {
      return { error: "This proof changed after you opened it. Nothing was counted. Load the current proof and decide that one.", code: "stale" };
    }
    if (await redis.get(resolvedKey(c))) return { error: "This review is already resolved." };

    let tally = await tallyOf(c);
    let counted = false;
    if (tally.real + tally.not < APPEAL_QUORUM) {
      if (typeof reason !== "string" || reason.trim().length < REVIEW_REASON_MIN || reason.trim().length > REVIEW_REASON_MAX) {
        return { error: `Explain your review in ${REVIEW_REASON_MIN} to ${REVIEW_REASON_MAX.toLocaleString("en-US")} characters.` };
      }
      // One vote per judge per proof. SADD is the atomic dedup.
      if (!(await redis.sadd(votersKey(c), j))) return { error: "You have already reviewed this proof." };
      await redis.hincrby(tallyKey(c), real ? "real" : "not", 1);
      await redis.lpush(reasonsKey(c), JSON.stringify({ real, reason: reason.trim(), at: new Date(now).toISOString() }));
      tally = await tallyOf(c);
      counted = true;
    }
    // From here the tally is closed: three votes are in and no fourth is taken,
    // so a late vote can never flip a decision. Whoever calls next, the last
    // judge included, only finishes it.
    const outcome = appealOutcome(tally);
    if (outcome === "pending") return { counted, outcome, tally };

    // The wallet exactly as the favour holds it: the points profile is keyed by
    // that string, and lowercasing it here would credit a different profile.
    const wallet = t.claimant!;
    const person = wallet.toLowerCase();
    const at = new Date(now).toISOString();
    let points = 0;
    let credited = false;
    try {
      if (outcome === "cleared") {
        // 1. THE SLOT AND ITS MARKER, one operation.
        const slotTask = scope === "welcome_instance" ? t.welcomeSourceId! : t.id;
        const slot = await redis.eval(CLAIM_SLOT_FOR_CASE, [completedClaimantsKey(slotTask), slotKey(c)], [person, MARKER_TTL]);
        if (slot !== "credit" && slot !== "none") return RETRY;
        if (slot === "credit") {
          credited = true;
          points = completionPointsFor(t.rewardType, t.bountyUsdc);
          // 2. THE CREDIT, strict and keyed. "already" means an earlier call
          //    landed it and lost the answer.
          if (points > 0) await creditCompletionStrict(wallet, points, creditRef(c));
          // 3. THE HISTORY ROW AND ITS MARKER, one operation.
          const row = buildContribution({
            taskId: t.id, description: t.description, points, streakBonus: 0,
            proofImageUrl: t.proofImageUrl, proofNote: t.proofNote,
            campaignId: t.campaignId ?? null, campaignLabel: t.campaignId ? "Welcome" : null, now,
          });
          await redis.eval(RECORD_HISTORY_ONCE, [historyKey(c), contributionsKey(person)], [at, JSON.stringify(row), CONTRIBUTIONS_MAX, MARKER_TTL]);
        }
      }
    } catch (err) {
      console.error(`[house-review] resolution not confirmed for ${t.id}:`, err);
      return RETRY;
    }

    // 4. THE FAVOUR'S OWN ROW.
    const reasons = outcome === "upheld"
      ? ((await redis.lrange(reasonsKey(c), 0, APPEAL_QUORUM + 2)) as unknown[])
          .map((r) => { try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; } })
          .filter((r): r is { real: boolean; reason: string } => !!r && r.real === false && typeof r.reason === "string")
          .map((r) => r.reason.slice(0, 280))
      : [];
    try {
    if (scope === "welcome_instance") {
      if (outcome === "cleared") {
        // The AI's flag stays a flag. The human decision is written beside it.
        t.status = "completed";
        t.completionCount = 1;
        t.humanReview = { caseId: c, outcome: "cleared", at };
        t.welcomeReviewNote = null;
      } else {
        // Not accepted: the person's own step opens again for a new proof.
        t.status = "open";
        t.claimant = null;
        t.claimantVerification = null;
        t.proofImageUrl = null;
        t.proofImages = null;
        t.proofNote = null;
        t.verificationResult = null;
        t.aiFollowUp = null;
        t.welcomeReviewNote = { outcome: "upheld", at, reasons };
      }
      await saveWelcomeInstance(t);
    } else {
      // A shared row: the store's own transition for a flag decided later, the
      // one the poster's decision uses. Accepted counts the reply and frees a
      // multi-reply favour for the next person; declined frees it. It refuses a
      // row that is no longer claimed and flagged, and a money favour. A person
      // who already held the step is not counted a second time: their proof is
      // released without a reply being added.
      await posterConfirm(t.id, outcome === "cleared" && credited);
    }

    // 5. ONLY NOW is the case resolved and out of the queue.
    await redis.set(resolvedKey(c), JSON.stringify({ outcome, at, person, reasons }), { ex: 90 * 86400 });
    await redis.srem(HOUSE_REVIEW_QUEUE, t.id);
    } catch (err) {
      console.error(`[house-review] resolution not confirmed for ${t.id}:`, err);
      return RETRY;
    }
    return { counted, outcome, tally, pointsAwardedToClaimant: points };
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", [lock], [token]).catch(() => {});
  }
}
