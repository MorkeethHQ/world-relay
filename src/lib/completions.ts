import { getRedis } from "./redis";

// THE PER-PERSON COMPLETION RECORD, added 2026-09-21.
//
// WHY IT HAS TO EXIST. A favour that more than one person may complete (the daily
// mission is maxCompletions 100) is reset on every pass: completeTask sets it back
// to `open` and clears claimant, proofImageUrl, proofImages and proofNote
// (store.ts, completeTask). So after someone completes today's mission, nothing in
// the store says WHO did it, the proof is gone from the task, /api/history (which
// lists status === completed) never shows it, and the mission stays actionable for
// the person who just did it. "Done today, see your proof" cannot be built on that.
//
// This record is written in verify-proof's pass branch, from values the request
// already holds, so the reset cannot erase it.
//
// KEY SHAPE is PR 10's (`completed_claimants:<taskId>`, `contributions:<addr>`),
// deliberately, so the two cannot diverge if that branch ever lands.
//
// Not a money record. It stores points and a proof link for display. Credit is
// still written only by recordFavourCompleted and the payout path; this module only
// decides, atomically and failing closed, whether a repeat pass may be credited.

export const COMPLETED_CLAIMANTS_PREFIX = "completed_claimants:";
export const CONTRIBUTIONS_PREFIX = "contributions:";
export const CONTRIBUTIONS_MAX = 50;
// A proof note is shown back to its author, never used as evidence, so it is
// capped at a readable length rather than stored whole.
export const NOTE_MAX = 280;

export type Contribution = {
  taskId: string;
  description: string;
  points: number;
  streakBonus: number;
  // A link only when the proof lives at a real URL (blob storage in production).
  // An inline data: URL is never stored here: it can be megabytes, and the task
  // row that pointed at it is wiped on reset anyway.
  proofImageUrl: string | null;
  proofNote: string | null;
  campaignId: string | null;
  at: string;
};

export function completedClaimantsKey(taskId: string): string {
  return `${COMPLETED_CLAIMANTS_PREFIX}${taskId}`;
}

export function contributionsKey(address: string): string {
  return `${CONTRIBUTIONS_PREFIX}${address.toLowerCase()}`;
}

function cap(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildContribution(input: {
  taskId: string;
  description: string;
  points: number;
  streakBonus: number;
  proofImageUrl: string | null | undefined;
  proofNote: string | null | undefined;
  campaignId?: string | null;
  now: number;
}): Contribution {
  const url = input.proofImageUrl && /^https?:\/\//.test(input.proofImageUrl) ? input.proofImageUrl : null;
  return {
    taskId: input.taskId,
    description: cap(input.description, NOTE_MAX) ?? "",
    points: input.points,
    streakBonus: input.streakBonus,
    proofImageUrl: url,
    proofNote: cap(input.proofNote, NOTE_MAX),
    campaignId: input.campaignId ?? null,
    at: new Date(input.now).toISOString(),
  };
}

// Appends the display row for a pass. The completer SET is not written here: it is
// claimed atomically by claimCompletionSlot BEFORE any credit, which is what makes
// the duplicate guard hold under concurrency.
export async function recordTaskCompletion(address: string, c: Contribution): Promise<void> {
  const redis = getRedis();
  if (!redis || !address) return;
  const addr = address.toLowerCase();
  await redis.lpush(contributionsKey(addr), JSON.stringify(c));
  await redis.ltrim(contributionsKey(addr), 0, CONTRIBUTIONS_MAX - 1);
}

// THE DUPLICATE-REWARD GUARD FAILS CLOSED (review, 2026-09-21).
//
// An earlier draft returned `false` on a store error, "fail open, at most one
// duplicate". That was wrong: a PERSISTENT error makes every check pass, so a long
// outage would allow unbounded repeat passes. A reward guard that cannot read its
// record must refuse, not wave through. So there are three answers, and the caller
// refuses on anything but a definite "no".
export type CompletionCheck = "yes" | "no" | "unknown";

export async function checkCompletedTask(taskId: string, address: string): Promise<CompletionCheck> {
  const redis = getRedis();
  // No store configured at all (local preview): nothing is recorded anywhere, so
  // there is nothing to protect. Production always has a store.
  if (!redis) return "no";
  if (!address) return "unknown";
  try {
    return (await redis.sismember(completedClaimantsKey(taskId), address.toLowerCase())) === 1 ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

// Claims this person's single completion slot on a favour, ATOMICALLY, before any
// credit is written. SADD returns 1 only to the caller that actually added the
// member, so two concurrent passes by the same wallet cannot both get "claimed",
// whatever the interleaving. Anything but "claimed" means: write no credit.
export type SlotClaim = "claimed" | "duplicate" | "unknown";

export async function claimCompletionSlot(taskId: string, address: string): Promise<SlotClaim> {
  const redis = getRedis();
  if (!redis) return "claimed";
  if (!address) return "unknown";
  try {
    const added = await redis.sadd(completedClaimantsKey(taskId), address.toLowerCase());
    return added === 1 ? "claimed" : "duplicate";
  } catch {
    return "unknown";
  }
}

export async function listContributions(address: string, limit = CONTRIBUTIONS_MAX): Promise<Contribution[]> {
  const redis = getRedis();
  if (!redis || !address) return [];
  const raw = await redis.lrange(contributionsKey(address), 0, Math.max(0, limit - 1)).catch(() => [] as unknown[]);
  const out: Contribution[] = [];
  for (const r of raw as unknown[]) {
    try {
      const c = typeof r === "string" ? JSON.parse(r) : r;
      if (c && typeof c.taskId === "string") out.push(c as Contribution);
    } catch {
      // One bad row must not blank a person's history.
    }
  }
  return out;
}
