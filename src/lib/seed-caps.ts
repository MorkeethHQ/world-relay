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
): Promise<{ allowed: boolean; message?: string }> {
  if (!isSeededTask(task)) return { allowed: true };
  const redis = getRedis();
  if (!redis) return { allowed: true };

  const kind = seedKind(task);
  const cap = kind === "funded" ? SEEDED_FUNDED_DAILY_CAP : SEEDED_POINTS_DAILY_CAP;
  const count = Number((await redis.get(capKey(kind, claimant))) || 0);
  if (count >= cap) {
    return {
      allowed: false,
      message:
        kind === "funded"
          ? "You've already earned an official USDC favour today. Come back tomorrow — or pick up favours posted by other people."
          : "Daily limit reached for official favours. Come back tomorrow — or pick up favours posted by other people.",
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
