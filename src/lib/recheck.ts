import type { Task } from "./types";
import { getRedis } from "./redis";
import { getTask, listTasks, completeTask } from "./store";
import { isRealMoney } from "./reward";
import { isHiddenTask } from "./task-serializer";
import { buildContribution, claimCompletionSlot, recordTaskCompletion } from "./completions";
import { recordCompletion, recordFailure, getReputation } from "./reputation";
import { recordFavourAttempted, recordFavourCompleted, recordFavourFailed, completionPointsFor, streakBonusFor } from "./proof-of-favour";
import { recordReferralActivation } from "./referral";
import { recordSeededEarn } from "./seed-caps";
import { addNotification } from "./notifications-store";
import { personTip } from "./proof-tip";

// RE-CHECK OF PROOFS THE CHECK NEVER JUDGED (2026-10-05).
//
// On 4 Oct 2026 the live app held 36 favours whose stored verdict was the
// fallback written when verifyProof THROWS (the catch branch in
// /api/verify-proof). No model and no person judged those proofs. The task page
// hides the submit button while a proof is flagged, so the people who sent them
// cannot send them again, and the posters are house agents that never review.
//
// This module finds those favours and runs the same verifier on the proof that is
// already stored. It is called by scripts/recheck-thrown-proofs.mjs, which is a
// dry run unless --apply is given.
//
// WHAT IT WILL NOT TOUCH, each with a test:
//   - a flag that is a real model verdict (any confidence above 0, or any other text),
//   - any money favour (funded, usdc, usdc-v2, Double or Nothing),
//   - any campaign task or company piece (campaign progress and results are
//     written only by the verify-proof pass path, SECURITY-INVARIANTS inv 8),
//   - a recurring favour, a favour with a webhook, a hidden favour.
//
// WHAT IS THE SAME AS THE ROUTE'S PASS PATH for a plain points favour: the same
// verifyProof, completeTask, claimCompletionSlot, recordReferralActivation,
// recordSeededEarn, recordFavourAttempted, recordCompletion,
// recordFavourCompleted, completionPointsFor, streakBonusFor and
// recordTaskCompletion (the History row), in the same order.
//
// WHAT IS LEFT OUT ON PURPOSE: the on-chain attestation (it spends gas), XMTP
// thread posts, push notifications, the follow-up question, the SSE broadcast
// and the duplicate image check (the stored image already holds its own hash
// key). The person gets one in-app notification.

// The exact reasoning text the catch branch writes. A guard test pins that the
// route still contains it, so the two cannot drift apart silently.
export const THROWN_CHECK_TEXT = "AI verification error - proof flagged for manual review.";

export const RECHECK_LOG_KEY = "recheck:log";
export function recheckDoneKey(taskId: string, claimant: string): string {
  return `recheck:done:${taskId}:${claimant.toLowerCase()}`;
}

export type RecheckVerdict = { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number; tip?: string };
export type Verifier = (
  description: string,
  images: string[],
  proofNote: string | undefined,
  category: string | undefined,
  agentId: string | undefined,
) => Promise<RecheckVerdict>;

// True only for the fallback of a THROWN check: still claimed, flag, confidence
// exactly 0, and the exact text. A real model flag never matches, because a real
// flag has its own reasoning.
export function isThrownCheck(t: Task): boolean {
  const v = t.verificationResult;
  return (
    t.status === "claimed" &&
    !!v &&
    v.verdict === "flag" &&
    v.confidence === 0 &&
    typeof v.reasoning === "string" &&
    v.reasoning.startsWith(THROWN_CHECK_TEXT)
  );
}

// Why a thrown-check favour is still left alone. Null means it may be re-checked.
export function recheckSkipReason(t: Task): string | null {
  if (isHiddenTask(t)) return "hidden by the operator";
  if (!t.claimant) return "no claimant on the record";
  if (t.rewardType !== "points" || isRealMoney(t) || t.onChainId != null || !!t.escrowTxHash) return "money favour: only the live verify path may settle it";
  if (t.taskType === "double-or-nothing" || t.donOnChainId != null) return "double or nothing favour";
  if (t.campaignId) return "house campaign task: campaign progress is written only by the live verify path";
  if (t.companyCampaignId) return "company campaign piece: its result is written only by the live verify path";
  if (t.recurring) return "recurring favour";
  if (t.callbackUrl) return "favour with a webhook";
  const hasProof = !!(t.proofNote && t.proofNote.trim()) || !!t.proofImageUrl || !!(t.proofImages && t.proofImages.length);
  if (!hasProof) return "no stored proof to check";
  return null;
}

export type RecheckAction =
  | "would-recheck"
  | "skipped"
  | "passed"
  | "failed"
  | "flagged"
  | "still-failing"
  | "already-done"
  | "busy"
  | "changed";

export type RecheckOutcome = {
  taskId: string;
  claimant: string | null;
  description: string;
  action: RecheckAction;
  detail: string;
  points?: number;
};

const row = (t: Task, action: RecheckAction, detail: string, points?: number): RecheckOutcome => ({
  taskId: t.id,
  claimant: t.claimant,
  description: t.description.slice(0, 80),
  action,
  detail,
  ...(points === undefined ? {} : { points }),
});

// Stored proof images as raw base64, the form verifyProof takes. A proof is
// stored either inline (data: URL) or at a blob URL.
async function storedImages(t: Task, fetchImpl: typeof fetch): Promise<string[]> {
  const urls = t.proofImages && t.proofImages.length ? t.proofImages : t.proofImageUrl ? [t.proofImageUrl] : [];
  const out: string[] = [];
  for (const u of urls.slice(0, 3)) {
    if (u.startsWith("data:")) {
      out.push(u.replace(/^data:image\/\w+;base64,/, ""));
    } else if (/^https?:\/\//.test(u)) {
      const r = await fetchImpl(u);
      if (!r.ok) throw new Error(`stored image answered ${r.status}`);
      out.push(Buffer.from(await r.arrayBuffer()).toString("base64"));
    } else {
      throw new Error("stored image is neither inline nor a URL");
    }
  }
  return out;
}

export type RecheckOptions = {
  apply: boolean;
  verify: Verifier;
  only?: string;
  limit?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

// Dry run (apply false): reads the task list and reports. No lock, no marker, no
// verifier call, no write of any kind.
export async function recheckThrownProofs(opts: RecheckOptions): Promise<RecheckOutcome[]> {
  const all = await listTasks();
  let candidates = all.filter(isThrownCheck);
  if (opts.only) candidates = candidates.filter((t) => t.id === opts.only);
  const out: RecheckOutcome[] = [];
  let done = 0;
  for (const t of candidates) {
    const skip = recheckSkipReason(t);
    if (skip) {
      out.push(row(t, "skipped", skip));
      continue;
    }
    if (opts.limit !== undefined && done >= opts.limit) break;
    done++;
    if (!opts.apply) {
      const kind = t.proofImageUrl || (t.proofImages && t.proofImages.length) ? "photo" : "text";
      out.push(row(t, "would-recheck", `${kind} proof, ${t.bountyUsdc} points, reply ${(t.completionCount ?? 0) + 1} of ${t.maxCompletions}`));
      continue;
    }
    out.push(await recheckOne(t.id, opts));
  }
  return out;
}

async function recheckOne(taskId: string, opts: RecheckOptions): Promise<RecheckOutcome> {
  const redis = getRedis();
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!redis) throw new Error("no store configured: a real run needs KV_REST_API_URL and KV_REST_API_TOKEN");

  // The same lock the live route takes, so a re-check and a live submission can
  // never work on one favour at the same time.
  const lockKey = `lock:verify:${taskId}`;
  const locked = await redis.set(lockKey, "recheck", { nx: true, px: 120000 });
  if (!locked) {
    const t = await getTask(taskId);
    return { taskId, claimant: t?.claimant ?? null, description: t?.description.slice(0, 80) ?? "", action: "busy", detail: "a verification is in progress on this favour; run again later" };
  }
  try {
    // Read again under the lock: the list may be minutes old.
    const task = await getTask(taskId);
    if (!task || !isThrownCheck(task) || recheckSkipReason(task) || !task.claimant) {
      return { taskId, claimant: task?.claimant ?? null, description: task?.description.slice(0, 80) ?? "", action: "changed", detail: "no longer a thrown-check favour; left alone" };
    }
    const claimant = task.claimant;
    const doneKey = recheckDoneKey(taskId, claimant);
    if (await redis.get(doneKey)) {
      return row(task, "already-done", "a re-check was already applied for this person on this favour; see recheck:log");
    }

    // The check itself. Nothing has been written yet, so a throw here leaves the
    // favour exactly as it was and it can be tried again.
    let result: RecheckVerdict;
    try {
      const images = await storedImages(task, fetchImpl);
      result = await opts.verify(task.description, images, task.proofNote ?? undefined, task.category, task.agent?.id);
    } catch (err) {
      return row(task, "still-failing", `the check threw again: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}. Nothing written`);
    }
    // A flag at confidence 0 is another non-judgement (the verifier's own
    // "could not parse" fallback). Storing it would trade one empty flag for another.
    const judged = result.verdict === "pass" || result.verdict === "fail" || (result.verdict === "flag" && result.confidence > 0);
    if (!judged || typeof result.reasoning !== "string") {
      return row(task, "still-failing", "the check answered without a judgement. Nothing written");
    }

    // The idempotency marker, taken atomically BEFORE any credit. A second run,
    // or a run that crashed after this line, can never credit twice.
    const at = new Date(now()).toISOString();
    const marked = await redis.set(doneKey, JSON.stringify({ verdict: result.verdict, at }), { nx: true });
    if (!marked) return row(task, "already-done", "a re-check was already applied for this person on this favour");

    // Kept from the record now: completeTask wipes the proof on a reopen.
    const proofNote = task.proofNote ?? null;
    const proofImageUrl = task.proofImageUrl ?? null;
    const stored = { verdict: result.verdict, confidence: result.confidence, reasoning: `${result.reasoning} | Re-checked ${at.slice(0, 10)} after the first check threw` };
    await completeTask(taskId, stored);

    let points: number | undefined;
    let action: RecheckAction;
    let detail: string;
    if (result.verdict === "pass") {
      // Same credit gate as the route: on a multi-reply favour the person's slot is
      // claimed atomically, and anything but "claimed" writes no credit.
      const slot = task.maxCompletions > 1 ? await claimCompletionSlot(taskId, claimant) : "claimed";
      if (slot !== "claimed") {
        action = "passed";
        detail = `passed, but the completion slot answered "${slot}": no credit written`;
      } else {
        const level = task.claimantVerification || undefined;
        await recordReferralActivation(claimant).catch(console.error);
        await recordSeededEarn(task, claimant).catch(console.error);
        await recordFavourAttempted(claimant).catch(console.error);
        // The streak is read BEFORE this completion is recorded. The live route
        // starts recordCompletion without awaiting it and reads the reputation in
        // the same tick, so in practice it pays the bonus on the streak the person
        // had coming in. Reading first makes that the rule here, not a race.
        const rep = await getReputation(claimant);
        await recordCompletion(claimant, task.bountyUsdc, result.confidence, level, false).catch(console.error);
        const completion = completionPointsFor(task.rewardType, task.bountyUsdc);
        await recordFavourCompleted(claimant, rep.currentStreak, completion).catch(console.error);
        const streakBonus = streakBonusFor(rep.currentStreak);
        points = completion + streakBonus;
        // The History row for the person.
        await recordTaskCompletion(
          claimant,
          buildContribution({ taskId, description: task.description, points, streakBonus, proofImageUrl, proofNote, campaignId: null, campaignLabel: null, now: now() }),
        );
        await addNotification({
          userId: claimant,
          type: "verified",
          title: "Proof verified!",
          body: `We checked your proof again and it was accepted. ${Math.round(points)} points awarded.`,
          taskId,
        }).catch(console.error);
        action = "passed";
        detail = `accepted, ${points} points, History row written`;
      }
    } else if (result.verdict === "fail") {
      await recordFailure(claimant).catch(console.error);
      await recordFavourFailed(claimant).catch(console.error);
      await addNotification({
        userId: claimant,
        type: "proof_rejected",
        title: "Proof not accepted",
        body: `Not accepted yet: "${task.description.slice(0, 40)}...". ${personTip(result, task.category)} You can try again.`,
        taskId,
      }).catch(console.error);
      action = "failed";
      detail = "not accepted; the favour is open again";
    } else {
      action = "flagged";
      detail = `a real flag now (confidence ${result.confidence}); still held for review`;
    }

    await redis.lpush(RECHECK_LOG_KEY, JSON.stringify({ taskId, claimant, verdict: result.verdict, confidence: result.confidence, points: points ?? 0, at })).catch(console.error);
    return row(task, action, detail, points);
  } finally {
    await redis.del(lockKey).catch(console.error);
  }
}
