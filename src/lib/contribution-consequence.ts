/**
 * Personal contribution consequence — the chain a helper can return to:
 * contribution → evidence → authoritative verdict → credit → next action.
 *
 * Survives multi-completion reopen (task row clears claimant/proof) by writing
 * a durable per-wallet ledger. Never invents supply or success.
 */
import type { Task } from "./types";
import { getRedis } from "./redis";
import { completionPointsFor } from "./proof-of-favour";
import { isFunded } from "./reward";

export const COMPLETED_CLAIMANTS_PREFIX = "completed_claimants:";
export const CONTRIBUTIONS_PREFIX = "contributions:";
export const CONTRIBUTIONS_MAX = 50;

export type ConsequenceNextAction =
  | { kind: "jury"; label: string }
  | { kind: "board"; label: string }
  | { kind: "none"; label: string };

export type ContributionConsequence = {
  taskId: string;
  description: string;
  category: string;
  evidence: { note: string | null; hasImage: boolean };
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  /** Points credited for this favour (0 when not a points pass). Derived at award time. */
  creditPts: number;
  creditKind: "points" | "usdc" | "none" | "pending";
  at: string;
  nextAction: ConsequenceNextAction;
};

/** Redis set membership key for claimants who already earned a pass on this task. */
export function completedClaimantsKey(taskId: string): string {
  return `${COMPLETED_CLAIMANTS_PREFIX}${taskId}`;
}

export function contributionsKey(address: string): string {
  return `${CONTRIBUTIONS_PREFIX}${address.toLowerCase()}`;
}

/**
 * Pure credit preview for a pass — same formula verify-proof awards for the
 * favour line (streak is a separate history line and is not folded in here).
 */
export function creditPtsForPass(task: Pick<Task, "rewardType" | "bountyUsdc">): number {
  if (task.rewardType !== "points") return 0;
  return completionPointsFor(task.rewardType, task.bountyUsdc);
}

export function buildConsequence(input: {
  task: Task;
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  fromBridge?: boolean;
  creditPts?: number;
}): ContributionConsequence {
  const { task, verdict, reasoning, fromBridge } = input;
  let creditPts = 0;
  let creditKind: ContributionConsequence["creditKind"] = "none";

  if (verdict === "pass") {
    if (task.rewardType === "points") {
      creditPts = typeof input.creditPts === "number" ? input.creditPts : creditPtsForPass(task);
      creditKind = "points";
    } else if (isFunded(task) || task.rewardType === "usdc" || task.rewardType === "usdc-v2") {
      creditKind = task.settlementTx ? "usdc" : "pending";
      creditPts = 0;
    }
  } else if (verdict === "flag") {
    creditKind = "pending";
  }

  return {
    taskId: task.id,
    description: task.description,
    category: task.category,
    evidence: {
      note: task.proofNote,
      hasImage: !!(task.proofImageUrl || (task.proofImages && task.proofImages.length > 0)),
    },
    verdict,
    reasoning,
    creditPts,
    creditKind,
    at: new Date().toISOString(),
    nextAction: pickNextAction(verdict, !!fromBridge),
  };
}

export function pickNextAction(
  verdict: "pass" | "flag" | "fail",
  fromBridge: boolean
): ConsequenceNextAction {
  if (verdict === "pass") {
    if (fromBridge) {
      return { kind: "jury", label: "Return to Real or Not" };
    }
    return { kind: "board", label: "Back to favours" };
  }
  if (verdict === "flag") {
    return { kind: "none", label: "Pending review — nothing more to do here yet" };
  }
  return { kind: "board", label: "This favour is unavailable to you — find another" };
}

export async function recordCompletedClaimant(
  taskId: string,
  claimant: string
): Promise<void> {
  const redis = getRedis();
  if (!redis || !claimant) return;
  await redis.sadd(completedClaimantsKey(taskId), claimant).catch(() => {});
}

export async function hasCompletedClaimant(
  taskId: string,
  claimant: string
): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !claimant) return false;
  const hit = await redis.sismember(completedClaimantsKey(taskId), claimant).catch(() => 0);
  return !!hit;
}

export async function recordContributionConsequence(
  address: string,
  consequence: ContributionConsequence
): Promise<void> {
  const redis = getRedis();
  if (!redis || !address) return;
  const key = contributionsKey(address);
  try {
    await redis.lpush(key, JSON.stringify(consequence));
    await redis.ltrim(key, 0, CONTRIBUTIONS_MAX - 1);
  } catch {
    // best-effort ledger — never block verification
  }
}

export async function listContributionConsequences(
  address: string,
  limit = 30
): Promise<ContributionConsequence[]> {
  const redis = getRedis();
  if (!redis || !address) return [];
  const raw = await redis.lrange(contributionsKey(address), 0, Math.max(0, limit - 1)).catch(() => []);
  const out: ContributionConsequence[] = [];
  for (const item of raw || []) {
    try {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      if (parsed && typeof parsed === "object" && parsed.taskId && parsed.verdict) {
        out.push(parsed as ContributionConsequence);
      }
    } catch {
      // skip corrupt rows
    }
  }
  return out;
}

/**
 * Naive bridge picker baseline: shape gate only. Used in evals to measure
 * whether exclusion-aware picking is better than the two-hour default.
 * Does NOT check completed_claimants, seed cap, or failed_claimants.
 */
export function naiveBridgeEligibleIds(
  tasks: Task[],
  judge: string | null,
  isShapeEligible: (task: Task, judge: string | null, all: Task[]) => boolean
): string[] {
  return tasks.filter((t) => isShapeEligible(t, judge, tasks)).map((t) => t.id);
}
