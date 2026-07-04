import type { Task } from "./types";

// SINGLE SOURCE OF TRUTH for how a reward is described and classified.
// Every component that shows a task reward MUST use these helpers (or <RewardBadge>).
// Points and real money are never conflated: points are `pts`, money is `$ USDC`,
// and a task is only "real money" when it is escrow-funded on-chain.

export function isPointsReward(task: Pick<Task, "rewardType">): boolean {
  return task.rewardType === "points";
}

// True when a task carries real on-chain escrow (either signal).
export function isFunded(task: Pick<Task, "onChainId" | "escrowTxHash">): boolean {
  return task.onChainId !== null || !!task.escrowTxHash;
}

// True only when real USDC is actually escrowed on-chain for this task.
export function isRealMoney(task: Pick<Task, "rewardType" | "escrowTxHash" | "onChainId">): boolean {
  return task.rewardType !== "points" && isFunded(task);
}

// The reward amount as a human label, e.g. "10 pts" or "$5 USDC".
export function rewardAmountLabel(task: Pick<Task, "rewardType" | "bountyUsdc">): string {
  return isPointsReward(task)
    ? `${Math.round(task.bountyUsdc)} pts`
    : `$${task.bountyUsdc} USDC`;
}

// Short kind label used on pills/badges: "points" (purple) or "USDC" (green).
export function rewardKindLabel(task: Pick<Task, "rewardType">): "points" | "USDC" {
  return isPointsReward(task) ? "points" : "USDC";
}

// Sum a list of tasks into points and real-USDC totals, kept strictly separate.
export function sumRewards(tasks: Array<Pick<Task, "rewardType" | "escrowTxHash" | "onChainId" | "bountyUsdc" | "status">>, opts?: { completedOnly?: boolean }) {
  let points = 0;
  let usdc = 0;
  for (const t of tasks) {
    if (opts?.completedOnly && t.status !== "completed") continue;
    if (isPointsReward(t)) points += t.bountyUsdc;
    else if (isFunded(t)) usdc += t.bountyUsdc;
  }
  return { points: Math.round(points), usdc: Math.round(usdc * 100) / 100 };
}
