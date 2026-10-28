import type { Task } from "@/lib/types";

export type SimplePaymentStep = "accept" | "fund" | "prove" | "pay" | "done" | "wait";

/**
 * One visible next step for a paid favour. The escrow contract still provides
 * the safety, but a person should never have to understand the contract state
 * machine to know what to do next.
 */
export function simplePaymentStep(
  task: Pick<Task, "rewardType" | "poster" | "claimant" | "status" | "escrowTxHash" | "settlementTx" | "escrowV2RefundTx" | "pendingRelease">,
  viewer: string | null,
): SimplePaymentStep | null {
  if (task.rewardType !== "usdc-v2") return null;
  if (task.settlementTx || task.status === "completed") return "done";
  if (task.escrowV2RefundTx || task.status === "expired" || task.status === "cancelled" || task.status === "failed") return "done";

  const me = viewer?.toLowerCase() ?? null;
  const poster = task.poster.toLowerCase();
  const claimant = task.claimant?.toLowerCase() ?? null;

  if (me && me === poster) {
    if (task.status === "claimed" && claimant && !task.escrowTxHash) return "fund";
    if (task.escrowTxHash && task.pendingRelease) return "pay";
    return "wait";
  }

  if (me && claimant && me === claimant) {
    if (!task.escrowTxHash) return "wait";
    if (task.pendingRelease) return "wait";
    return task.status === "claimed" ? "prove" : "wait";
  }

  if (me && task.status === "open") return "accept";
  return "wait";
}
