import type { Task } from "./types";
import { getRedis } from "./redis";
import { getTask, listTasks, completeTask } from "./store";
import { isRealMoney } from "./reward";
import { isHiddenTask } from "./task-serializer";
import { buildContribution, recordTaskCompletion, completedClaimantsKey, contributionsKey, CONTRIBUTIONS_MAX } from "./completions";
import { recordCompletion, recordFailure, getReputation, forgetReputation, hasReputationCreditRef } from "./reputation";
import { recordFavourAttempted, recordFavourCompleted, recordFavourFailed, completionPointsFor, streakBonusFor, hasPointsCreditRef } from "./proof-of-favour";
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
//
// HOW A PARTIAL FAILURE IS SURVIVED (2026-10-05, finding A of the 01:00 review).
// The first version took a permanent marker, then applied the verdict, then wrote
// the credits and only logged their errors. A failure in the middle left the
// person uncredited, the proof wiped and the marker blocking every retry, while
// the run reported points awarded. Now:
//
//   1. A JOURNAL is written first (recheck:job:<taskId>:<person>, state
//      "in-progress"). It holds the verdict, the proof and every value the credit
//      needs, so nothing that is wiped from the favour later is lost.
//   2. Every step is CHECKED AT THE STORE before it is done and after it is done.
//      A step that is already there is skipped. A step that cannot be confirmed
//      stops the item: it is reported "failed", never "passed".
//   3. The three credit writes are KEYED by favour and person. The key is stored
//      in the same write as the credit (creditRefs on the points profile and on
//      the reputation), so running a step twice cannot credit twice.
//   4. The journal becomes "done" only after every credit was read back.
//   5. Every real run first finishes the journals still in progress
//      (recheck:pending). So the recovery from any failure is: run it again.

// The exact reasoning text the catch branch writes. A guard test pins that the
// route still contains it, so the two cannot drift apart silently.
export const THROWN_CHECK_TEXT = "AI verification error - proof flagged for manual review.";

export const RECHECK_LOG_KEY = "recheck:log";
export const RECHECK_PENDING_KEY = "recheck:pending";
export function recheckJobKey(taskId: string, claimant: string): string {
  return `recheck:job:${taskId}:${claimant.toLowerCase()}`;
}
// The key stored beside each credit. One favour, one person (the profile it is
// stored on), one credit.
export function recheckCreditRef(taskId: string): string {
  return `recheck:${taskId}`;
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
  // The points ledger and the reputation store only real wallets. Anything else
  // could never be read back, so it is refused up front.
  if (!/^0x[0-9a-fA-F]{40}$/.test(t.claimant)) return "claimant is not a wallet address: points cannot be written";
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
  | "would-resume"
  | "skipped"
  | "passed"
  | "rejected"
  | "flagged"
  | "failed"
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
  // Present only when the points were written AND read back from the store.
  points?: number;
};

const row = (t: { id: string; claimant: string | null; description: string }, action: RecheckAction, detail: string, points?: number): RecheckOutcome => ({
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

// What the journal keeps of the favour: everything the credit needs, without the
// inline image bytes (History only ever links an image that lives at a URL).
type JournalTask = Omit<Task, "proofImages" | "verificationResult">;

export type RecheckJournal = {
  state: "in-progress" | "done";
  taskId: string;
  claimant: string;
  startedAt: string;
  updatedAt: string;
  doneAt?: string;
  verdict: { verdict: "pass" | "flag" | "fail"; confidence: number; reasoning: string };
  tip?: string;
  task: JournalTask;
  // Read before anything was written, so a resumed run pays the same amount.
  streak: number;
  completion: number;
  points: number;
  // Was this person's completer slot free before this job touched it. Read before
  // the job's own SADD, so a resumed run can tell its own slot from an older one.
  slotFreeBefore: boolean;
  // Side effects that are not credit to this person. Each flag is saved BEFORE the
  // call, so they happen at most once (a crash in between drops one, never doubles).
  once: { referral?: true; seeded?: true; failure?: true; notified?: true; logged?: true };
  lastError?: string;
};

class StepError extends Error {}

type Store = NonNullable<ReturnType<typeof getRedis>>;

async function loadJournal(redis: Store, key: string): Promise<RecheckJournal | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as RecheckJournal;
}

async function saveJournal(redis: Store, j: RecheckJournal, now: number): Promise<void> {
  j.updatedAt = new Date(now).toISOString();
  await redis.set(recheckJobKey(j.taskId, j.claimant), JSON.stringify(j));
}

// Is this favour still waiting for THIS person's thrown-check verdict to be replaced.
const awaitsVerdict = (t: Task | undefined, claimant: string): boolean => !!t && isThrownCheck(t) && t.claimant === claimant;

// The History row, read strictly: a store error throws instead of reading as "no row".
async function hasHistoryRow(redis: Store, claimant: string, taskId: string): Promise<boolean> {
  const raw = (await redis.lrange(contributionsKey(claimant), 0, CONTRIBUTIONS_MAX - 1)) as unknown[];
  return raw.some((r) => {
    try {
      const c = typeof r === "string" ? JSON.parse(r) : r;
      return !!c && (c as { taskId?: string }).taskId === taskId;
    } catch {
      return false;
    }
  });
}

// One credit step: skip if the store already shows it, otherwise write, then read
// it back. A write that throws and a write that silently did nothing are the same
// thing here: the read-back decides.
async function confirmed(name: string, isThere: () => Promise<boolean>, write: () => Promise<unknown>): Promise<void> {
  if (await isThere()) return;
  let thrown: unknown = null;
  try {
    await write();
  } catch (err) {
    thrown = err;
  }
  if (!(await isThere())) {
    const why = thrown instanceof Error ? `: ${thrown.message.slice(0, 120)}` : "";
    throw new StepError(`${name} was not written${why}`);
  }
}

// Carries a journal to "done". Safe to call any number of times on the same journal.
async function finish(redis: Store, j: RecheckJournal, now: () => number): Promise<RecheckOutcome> {
  const id = j.taskId;
  const who = j.claimant;
  const pass = j.verdict.verdict === "pass";

  // Step 1: the verdict on the favour. One write. If the favour no longer waits
  // for this person's verdict, the write already happened (or the favour moved on
  // by another road, for example it expired); the verdict in the journal stands.
  if (awaitsVerdict(await getTask(id), who)) {
    await completeTask(id, j.verdict).catch(() => null);
    if (awaitsVerdict(await getTask(id), who)) throw new StepError("the verdict was not stored on the favour");
  }

  let credited = false;
  if (pass) {
    // Step 2: the completer slot on a multi-reply favour, same gate as the route.
    // SADD is repeatable; whether the slot is OURS was settled before any write.
    let slotOk = true;
    if (j.task.maxCompletions > 1) {
      const key = completedClaimantsKey(id);
      await redis.sadd(key, who.toLowerCase());
      if ((await redis.sismember(key, who.toLowerCase())) !== 1) throw new StepError("the completer slot was not written");
      slotOk = j.slotFreeBefore;
    }
    if (slotOk) {
      const ref = recheckCreditRef(id);
      const level = j.task.claimantVerification || undefined;
      // Steps 3 to 5: the keyed credits, each read back from the store.
      await confirmed("the attempt on the points ledger", () => hasPointsCreditRef(who, `${ref}:attempted`), () => recordFavourAttempted(who, `${ref}:attempted`));
      await confirmed(
        "the completion on the reputation",
        () => hasReputationCreditRef(who, ref),
        async () => {
          forgetReputation(who);
          try {
            await recordCompletion(who, j.task.bountyUsdc, j.verdict.confidence, level, false, ref);
          } finally {
            // The reputation module updates its own copy before the store. Drop it,
            // so a failed write cannot look applied to the next attempt.
            forgetReputation(who);
          }
        },
      );
      await confirmed("the points on the points ledger", () => hasPointsCreditRef(who, `${ref}:completed`), () => recordFavourCompleted(who, j.streak, j.completion, `${ref}:completed`));
      // Step 6: the History row for the person.
      await confirmed(
        "the History row",
        () => hasHistoryRow(redis, who, id),
        () =>
          recordTaskCompletion(
            who,
            buildContribution({ taskId: id, description: j.task.description, points: j.points, streakBonus: j.points - j.completion, proofImageUrl: j.task.proofImageUrl, proofNote: j.task.proofNote, campaignId: null, campaignLabel: null, now: Date.parse(j.startedAt) }),
          ),
      );
      credited = true;
    }
  }

  // Not credit to this person: at most once each, flag saved before the call.
  const once = async (flag: keyof RecheckJournal["once"], fn: () => Promise<unknown>) => {
    if (j.once[flag]) return;
    j.once[flag] = true;
    await saveJournal(redis, j, now());
    await fn().catch(console.error);
  };
  if (credited) {
    await once("referral", () => recordReferralActivation(who));
    await once("seeded", () => recordSeededEarn(j.task as Task, who));
    await once("notified", () =>
      addNotification({ userId: who, type: "verified", title: "Proof verified!", body: `We checked your proof again and it was accepted. ${Math.round(j.points)} points awarded.`, taskId: id }),
    );
  } else if (j.verdict.verdict === "fail") {
    await once("failure", async () => {
      await recordFailure(who);
      await recordFavourFailed(who);
    });
    await once("notified", () =>
      addNotification({
        userId: who,
        type: "proof_rejected",
        title: "Proof not accepted",
        body: `Not accepted yet: "${j.task.description.slice(0, 40)}...". ${personTip({ verdict: "fail", tip: j.tip }, j.task.category)} You can try again.`,
        taskId: id,
      }),
    );
  }
  await once("logged", () =>
    redis.lpush(RECHECK_LOG_KEY, JSON.stringify({ taskId: id, claimant: who, verdict: j.verdict.verdict, confidence: j.verdict.confidence, points: credited ? j.points : 0, at: j.startedAt })),
  );

  // Done only now, after every credit was read back. Written from a copy, so a
  // failed save leaves this journal in progress, in the store and in memory.
  const finished: RecheckJournal = { ...j, state: "done", doneAt: new Date(now()).toISOString() };
  delete finished.lastError;
  await saveJournal(redis, finished, now());
  await redis.srem(RECHECK_PENDING_KEY, recheckJobKey(id, who)).catch(() => null);
  return outcomeOf(finished);
}

// Was credit due under this journal: a pass, and the completer slot was this job's.
const creditDue = (j: RecheckJournal): boolean => j.verdict.verdict === "pass" && (j.task.maxCompletions <= 1 || j.slotFreeBefore);

// The report row for a journal that is done. Points appear only here, so only for
// credits that were read back.
function outcomeOf(j: RecheckJournal): RecheckOutcome {
  const label = { id: j.taskId, claimant: j.claimant, description: j.task.description };
  if (creditDue(j)) return row(label, "passed", `accepted, ${j.points} points written and read back, History row written`, j.points);
  if (j.verdict.verdict === "pass") return row(label, "passed", "accepted, but this person already held the completion slot on this favour: no credit written");
  if (j.verdict.verdict === "fail") return row(label, "rejected", "not accepted; the favour is open again");
  return row(label, "flagged", `a real flag now (confidence ${j.verdict.confidence}); still held for review`);
}

export type RecheckOptions = {
  apply: boolean;
  verify: Verifier;
  only?: string;
  limit?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

const LOCK_MS = 120000;

// Runs `work` under the same lock the live route takes, so a re-check and a live
// submission can never work on one favour at the same time. Any error inside is
// turned into a "failed" row: the item stays in progress and the next run resumes it.
async function underLock(redis: Store, taskId: string, label: { id: string; claimant: string | null; description: string }, work: () => Promise<RecheckOutcome>): Promise<RecheckOutcome> {
  const lockKey = `lock:verify:${taskId}`;
  let locked: unknown = null;
  try {
    locked = await redis.set(lockKey, "recheck", { nx: true, px: LOCK_MS });
  } catch (err) {
    return row(label, "failed", `could not take the lock: ${err instanceof Error ? err.message.slice(0, 120) : "store error"}. Nothing written. Run the job again`);
  }
  if (!locked) return row(label, "busy", "a verification is in progress on this favour (or a run died less than 2 minutes ago); run again later");
  try {
    return await work();
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return row(label, "failed", `not complete: ${msg}. No points are reported for this item. Run the job again to finish it`);
  } finally {
    await redis.del(lockKey).catch(() => null);
  }
}

// Dry run (apply false): reads the task list and the pending set and reports. No
// lock, no journal, no verifier call, no write of any kind.
export async function recheckThrownProofs(opts: RecheckOptions): Promise<RecheckOutcome[]> {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: RecheckOutcome[] = [];
  const handled = new Set<string>();
  // How many items this run has taken on, resumed ones included.
  let done = 0;
  const redis = getRedis();
  if (opts.apply && !redis) throw new Error("no store configured: a real run needs KV_REST_API_URL and KV_REST_API_TOKEN");

  // First, the journals a previous run left in progress.
  if (redis) {
    const pending = ((await redis.smembers(RECHECK_PENDING_KEY)) as string[]).sort();
    for (const key of pending) {
      const j = await loadJournal(redis, key);
      if (!j) {
        if (opts.apply) await redis.srem(RECHECK_PENDING_KEY, key).catch(() => null);
        continue;
      }
      if (j.state === "done") {
        // Done but still listed: the run that finished it could not take it off
        // the list (it died after its last write, or the removal failed). That run
        // may or may not have printed its report, so this one says what the store
        // holds as "already-done" and never as a fresh award: no points field, so
        // no total counts it twice.
        if (opts.apply) {
          handled.add(j.taskId);
          await redis.srem(RECHECK_PENDING_KEY, key);
          const was = outcomeOf(j);
          out.push(row({ id: j.taskId, claimant: j.claimant, description: j.task.description }, "already-done", `finished by an earlier run on ${String(j.doneAt).slice(0, 10)}: ${was.detail}`));
        }
        continue;
      }
      if (opts.only && j.taskId !== opts.only) continue;
      // An item being resumed COUNTS against --limit (since 2026-10-05). So after a
      // one-favour step that failed, the same one-favour step finishes that favour
      // and starts nothing new. Items over the limit stay in progress for a later run.
      if (opts.limit !== undefined && done >= opts.limit) {
        handled.add(j.taskId);
        continue;
      }
      done++;
      handled.add(j.taskId);
      const label = { id: j.taskId, claimant: j.claimant, description: j.task.description };
      if (!opts.apply) {
        out.push(row(label, "would-resume", `a previous run stopped part way (${j.lastError ?? "no error recorded"}); a real run finishes it`));
        continue;
      }
      out.push(await underLock(redis, j.taskId, label, async () => {
        const fresh = (await loadJournal(redis, key)) ?? j;
        if (fresh.state === "done") return row(label, "already-done", "finished by another run");
        try {
          return await finish(redis, fresh, now);
        } catch (err) {
          fresh.lastError = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
          await saveJournal(redis, fresh, now()).catch(() => null);
          throw err;
        }
      }));
    }
  }

  let candidates = (await listTasks()).filter(isThrownCheck).filter((t) => !handled.has(t.id));
  if (opts.only) candidates = candidates.filter((t) => t.id === opts.only);
  for (const t of candidates) {
    const skip = recheckSkipReason(t);
    if (skip) {
      out.push(row(t, "skipped", skip));
      continue;
    }
    if (opts.limit !== undefined && done >= opts.limit) break;
    done++;
    if (!opts.apply || !redis) {
      const kind = t.proofImageUrl || (t.proofImages && t.proofImages.length) ? "photo" : "text";
      out.push(row(t, "would-recheck", `${kind} proof, ${t.bountyUsdc} points, reply ${(t.completionCount ?? 0) + 1} of ${t.maxCompletions}`));
      continue;
    }
    out.push(await underLock(redis, t.id, t, () => recheckOne(redis, t.id, opts.verify, now, fetchImpl)));
  }
  return out;
}

async function recheckOne(redis: Store, taskId: string, verify: Verifier, now: () => number, fetchImpl: typeof fetch): Promise<RecheckOutcome> {
  // Read again under the lock: the list may be minutes old.
  const task = await getTask(taskId);
  if (!task || !isThrownCheck(task) || recheckSkipReason(task) || !task.claimant) {
    return { taskId, claimant: task?.claimant ?? null, description: task?.description.slice(0, 80) ?? "", action: "changed", detail: "no longer a thrown-check favour; left alone" };
  }
  const claimant = task.claimant;
  const jobKey = recheckJobKey(taskId, claimant);

  let j = await loadJournal(redis, jobKey);
  if (j?.state === "done") return row(task, "already-done", "a re-check was already completed for this person on this favour; see recheck:log");

  if (!j) {
    // The check itself. Nothing has been written yet, so a throw here leaves the
    // favour exactly as it was and it can be tried again.
    let result: RecheckVerdict;
    try {
      const images = await storedImages(task, fetchImpl);
      result = await verify(task.description, images, task.proofNote ?? undefined, task.category, task.agent?.id);
    } catch (err) {
      return row(task, "still-failing", `the check threw again: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}. Nothing written`);
    }
    // A flag at confidence 0 is another non-judgement (the verifier's own
    // "could not parse" fallback). Storing it would trade one empty flag for another.
    const judged = result.verdict === "pass" || result.verdict === "fail" || (result.verdict === "flag" && result.confidence > 0);
    if (!judged || typeof result.reasoning !== "string") {
      return row(task, "still-failing", "the check answered without a judgement. Nothing written");
    }

    // Everything the credit will need, read BEFORE the first write.
    const at = new Date(now()).toISOString();
    forgetReputation(claimant);
    // The streak is read before this completion is recorded. The live route starts
    // recordCompletion without awaiting it and reads the reputation in the same
    // tick, so in practice it pays the bonus on the streak the person had coming in.
    const streak = result.verdict === "pass" ? (await getReputation(claimant)).currentStreak || 0 : 0;
    forgetReputation(claimant);
    const completion = completionPointsFor(task.rewardType, task.bountyUsdc);
    const slotFreeBefore = (await redis.sismember(completedClaimantsKey(taskId), claimant.toLowerCase())) !== 1;
    const { proofImages: _images, verificationResult: _verdict, ...rest } = task;
    void _images;
    void _verdict;
    const fresh: RecheckJournal = {
      state: "in-progress",
      taskId,
      claimant,
      startedAt: at,
      updatedAt: at,
      verdict: { verdict: result.verdict, confidence: result.confidence, reasoning: `${result.reasoning} | Re-checked ${at.slice(0, 10)} after the first check threw` },
      ...(result.tip ? { tip: result.tip } : {}),
      task: { ...rest, proofImageUrl: task.proofImageUrl && /^https?:\/\//.test(task.proofImageUrl) ? task.proofImageUrl : null },
      streak,
      completion,
      points: completion + streakBonusFor(streak),
      slotFreeBefore,
      once: {},
    };
    // SET NX: of two runs at once, one journal wins and both work from it.
    const created = await redis.set(jobKey, JSON.stringify(fresh), { nx: true });
    j = created ? fresh : await loadJournal(redis, jobKey);
    if (!j) throw new StepError("the journal could not be written");
    if (j.state === "done") return row(task, "already-done", "finished by another run");
  }
  // In the pending set BEFORE the favour is changed, on every path that reaches
  // finish. After the verdict is applied the favour no longer looks like a
  // candidate, and this set is how the next run finds the item. SADD is repeatable.
  await redis.sadd(RECHECK_PENDING_KEY, jobKey);

  try {
    return await finish(redis, j, now);
  } catch (err) {
    j.lastError = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    await saveJournal(redis, j, now()).catch(() => null);
    throw err;
  }
}
