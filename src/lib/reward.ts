import type { Task } from "./types";

// SINGLE SOURCE OF TRUTH for how a reward is described and classified.
// Every component that shows a task reward MUST use these helpers (or <RewardBadge>).
// Points and real money are never conflated: points are `pts`, money is `$ USDC`,
// and a task is only "real money" when it is escrow-funded on-chain.

export function isPointsReward(task: Pick<Task, "rewardType">): boolean {
  return task.rewardType === "points";
}

// FavourEscrowV2 rail (demand-gated: posted unfunded, funded at claimant-accept
// from the poster's own wallet). NOTE the signal split for v2:
//   - funded v2 => escrowTxHash holds the receipt-verified fund tx => isFunded
//     and isRealMoney are true (display/gate signals work unchanged).
//   - hasOnChainEscrow stays FALSE for v2 (onChainId is v1-only) ON PURPOSE:
//     v2 dollars are booked exclusively by the verify-released path after the
//     chain shows Released — never at AI proof-pass time, because release is
//     a poster-signed transaction the AI verdict cannot trigger.
export function isEscrowV2Task(task: Pick<Task, "rewardType">): boolean {
  return task.rewardType === "usdc-v2";
}

// Funding reward (points) a funder earns when their USDC-funded task settles.
// Pure + client-safe so the post form can preview it and the server can award
// the exact same number — one source, no drift. The award itself lives
// server-side in proof-of-favour, fired only on confirmed on-chain settlement.
export const FUNDING_REWARD_PER_USD = 10;
export const FUNDING_REWARD_CAP = 250;
export function fundingRewardPoints(bountyUsdc: number): number {
  if (!Number.isFinite(bountyUsdc) || bountyUsdc <= 0) return 0;
  const pts = Math.round(bountyUsdc) * FUNDING_REWARD_PER_USD;
  return Math.min(Math.max(pts, 0), FUNDING_REWARD_CAP);
}

// True when a task carries real on-chain escrow (either signal).
export function isFunded(task: Pick<Task, "onChainId" | "escrowTxHash">): boolean {
  return task.onChainId !== null || !!task.escrowTxHash;
}

// True only when real USDC is actually escrowed on-chain for this task.
// DISPLAY signal: safe for labels, filters and badges. It leans on rewardType and
// on isFunded's truthiness, so it answers "should this read as a money task?" —
// NOT "may I book dollars against this?". For that, use hasOnChainEscrow.
export function isRealMoney(task: Pick<Task, "rewardType" | "escrowTxHash" | "onChainId">): boolean {
  return task.rewardType !== "points" && isFunded(task);
}

// CREDIT signal: the strictest one. Real USDC verifiably escrowed on-chain, proven
// by an actual tx hash rather than a truthy string.
//
// isFunded (and so isRealMoney) accept ANY truthy escrowTxHash. That is deliberate
// for gates and labels, where leaning loose only adds protection — but it is wrong
// for crediting, where leaning loose invents money. The placeholder is not
// hypothetical: legacy seeds shipped escrowTxHash "funded" and passed every
// truthiness funding guard (Inv 3, see the note in api/seed/route.ts).
//
// Use this anywhere dollars get BOOKED (reputation, payouts, earnings totals).
// Written 2026-07-17 after rep.totalEarnedUsdc had to be rebuilt from on-chain
// truth across 24 wallets ($278 phantom; one wallet read $150 against a real $6).
export function hasOnChainEscrow(task: Pick<Task, "escrowTxHash" | "onChainId">): boolean {
  return task.onChainId != null && /^0x[0-9a-fA-F]{64}$/.test(String(task.escrowTxHash));
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
