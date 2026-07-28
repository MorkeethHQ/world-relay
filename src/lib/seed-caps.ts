import { getRedis } from "./redis";
import type { Task } from "./types";

// Per-wallet daily caps on OFFICIAL (seeded) tasks. Seeded USDC batches were
// getting swept by a single claimant within hours; these caps spread official
// bounties across the userbase. User-posted tasks are not capped here.
export const SEEDED_FUNDED_DAILY_CAP = 1;
export const SEEDED_POINTS_DAILY_CAP = 3;

export function isSeededTask(task: Task): boolean {
  return !!task.agent || (typeof task.poster === "string" && task.poster.startsWith("agent:"));
}

function seedKind(task: Task): "funded" | "points" {
  return task.onChainId !== null || task.escrowTxHash ? "funded" : "points";
}

function dayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

function capKey(kind: "funded" | "points", address: string): string {
  return `seedcap:${kind}:${address.toLowerCase()}:${dayBucket()}`;
}

export async function checkSeedCap(
  task: Task,
  claimant: string,
): Promise<{ allowed: boolean; message?: string; nextAction?: "jury" }> {
  if (!isSeededTask(task)) return { allowed: true };
  const redis = getRedis();
  if (!redis) return { allowed: true };

  const kind = seedKind(task);
  const cap = kind === "funded" ? SEEDED_FUNDED_DAILY_CAP : SEEDED_POINTS_DAILY_CAP;
  const count = Number((await redis.get(capKey(kind, claimant))) || 0);
  if (count >= cap) {
    // The churn moment, and it used to be a dead end. This fires for a user who
    // has just done the work and wants to do more — the most engaged person in
    // the app — and the old copy sent them to "favours posted by other people",
    // which on a board holding 2 open tasks out of 121 is an empty room.
    //
    // Measured 2026-07-28: cap_hit 67, against 717 proofs submitted and 31 tasks
    // (26%) that expired with nobody completing them. Willing workers and
    // available work exist and fail to meet.
    //
    // Judging is the one surface that cannot run out: REAL OR NOT recycles
    // proofs that have already been submitted, so it always has supply. It is
    // also the most-used action in the app by a distance (jury_verdict 1,608 vs
    // task_created 84). So the cap now hands the user the thing that is actually
    // there, instead of pointing at an empty board.
    return {
      allowed: false,
      nextAction: "jury",
      message:
        kind === "funded"
          ? "You've already earned an official USDC favour today — the limit resets tomorrow. Judge some proofs meanwhile: it earns points and there's always a queue."
          : "That's your daily limit on official favours — it resets tomorrow. Judge some proofs meanwhile: it earns points and there's always a queue.",
    };
  }
  return { allowed: true };
}

// Called once per passing verdict on a seeded task; day keys expire after 48h.
export async function recordSeededEarn(task: Task, claimant: string): Promise<void> {
  if (!isSeededTask(task)) return;
  const redis = getRedis();
  if (!redis) return;
  const key = capKey(seedKind(task), claimant);
  await redis.incr(key);
  await redis.expire(key, 172_800);
}
