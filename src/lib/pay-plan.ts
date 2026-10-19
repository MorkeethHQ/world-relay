// PAID REVIEWS (Oscar, 19 Oct 2026: "post app for review needs cash ofc, we
// should escrow it"). The pure part: what a builder commits to, what a slot is
// in, and the one transaction batch that funds the slots people have taken.
//
// THE SHAPE, and the one reason for it. FavourEscrowV2_1 binds the RECIPIENT at
// fund time (fund(taskId, recipient, amount, deadline)), and the brief forbids a
// new contract and any FAVOUR custody. So a builder cannot pay for ten reviews
// before ten reviewers exist. Instead: at post the builder COMMITS N slots at $X
// each and nothing moves. A reviewer takes a slot, which makes one child task
// (rewardType usdc-v2, claimant = the reviewer). The builder funds every taken,
// unfunded slot in ONE World App confirm. Per approved review the builder signs
// release. A funded slot with no approved review refunds to the builder after
// the deadline. FAVOUR never holds the money. Points stay the free option.

import { encodeFunctionData, getAddress } from "viem";
import {
  ESCROW_V2_ABI,
  ESCROW_V2_CONFIRM_GRACE_S,
  PERMIT2_ADDRESS,
  PERMIT2_APPROVE_ABI,
  escrowV2Address,
  escrowV2DeadlineFor,
  escrowV2Enabled,
  escrowV2TaskId,
  usdToUnits,
  type MiniKitTxPayload,
} from "@/lib/escrow-v2";
import { USDC_ADDRESS, WORLD_CHAIN_ID } from "@/lib/contracts";
import type { Task } from "@/lib/types";

/** The prices a builder can pick per review, in USDC. */
export const PAY_PRICES = [1, 2, 5] as const;
export const PAY_DEFAULT_USD = 2;
/** Slots per project: the same ten as the points reviews. */
export const PAY_SLOTS = 10;
/** A slot's proof deadline, in hours. Same as a points piece (campaign-drafts). */
export const PAY_SLOT_HOURS = 7 * 24;

export type PayPlan = { perReviewUsd: number; slots: number; createdAt: string };

/** The plan a builder sends with the post, or null when none or odd. */
export function payPlanFromInput(v: unknown, now: number): PayPlan | null {
  if (!v || typeof v !== "object") return null;
  const usd = Number((v as { perReviewUsd?: unknown }).perReviewUsd);
  if (!(PAY_PRICES as readonly number[]).includes(usd)) return null;
  return { perReviewUsd: usd, slots: PAY_SLOTS, createdAt: new Date(now).toISOString() };
}

/** A stored plan, checked again on the way out. */
export function payPlanOrNull(raw: unknown): PayPlan | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const usd = Number(r.perReviewUsd);
  const slots = Number(r.slots);
  if (!(PAY_PRICES as readonly number[]).includes(usd) || !Number.isInteger(slots) || slots < 1 || slots > 20) return null;
  return { perReviewUsd: usd, slots, createdAt: typeof r.createdAt === "string" ? r.createdAt : "" };
}

// Where a slot is. Derived from the task record that the existing escrow route
// writes, never stored twice.
export type SlotState = "taken" | "funded" | "reviewed" | "paid" | "refunded";

export function slotState(t: Pick<Task, "escrowTxHash" | "settlementTx" | "escrowV2RefundTx" | "pendingRelease">): SlotState {
  if (t.escrowV2RefundTx) return "refunded";
  if (t.settlementTx) return "paid";
  if (!t.escrowTxHash) return "taken";
  if (t.pendingRelease) return "reviewed";
  return "funded";
}

export const SLOT_LABEL: Record<SlotState, string> = {
  taken: "Waiting for your funding",
  funded: "Funded. Waiting for the review",
  reviewed: "Review in. Approve to pay",
  paid: "Paid",
  refunded: "Refunded to you",
};

/** True when this task is one paid review slot of the given project. */
export function isPaySlot(t: Pick<Task, "rewardType" | "companyCampaignId">, campaignId: string): boolean {
  return t.rewardType === "usdc-v2" && t.companyCampaignId === campaignId;
}

export type PublicSlot = { taskId: string; state: SlotState; reviewer: string | null; deadline: string; reclaimAfter: string; reclaimable: boolean };

/** What a screen may say about a project's slots. Wallets go to the builder and
 *  to the reviewer who holds the slot; everyone else sees the state only. */
export function publicSlots(slots: Task[], viewer: string | null, owner: string, nowMs: number = Date.now()): PublicSlot[] {
  const me = viewer?.toLowerCase() ?? null;
  const isOwner = !!me && me === owner.toLowerCase();
  return slots.map((t) => {
    // The escrow's own deadline: task deadline plus the confirm grace. The chain
    // decides; this only tells the builder when the Reclaim button means something.
    const reclaimAfterMs = Number(escrowV2DeadlineFor(t.deadline, nowMs)) * 1000;
    const state = slotState(t);
    return {
      taskId: t.id,
      state,
      reviewer: isOwner || (!!me && t.claimant?.toLowerCase() === me) ? t.claimant ?? null : null,
      deadline: t.deadline,
      reclaimAfter: new Date(reclaimAfterMs).toISOString(),
      reclaimable: state === "funded" && nowMs > reclaimAfterMs,
    };
  });
}

export function slotCounts(slots: Array<Pick<PublicSlot, "state">>, plan: PayPlan) {
  const by = (s: SlotState) => slots.filter((x) => x.state === s).length;
  return {
    taken: by("taken"), funded: by("funded"), reviewed: by("reviewed"), paid: by("paid"), refunded: by("refunded"),
    open: Math.max(0, plan.slots - slots.length),
  };
}

/** Why this wallet cannot take a slot now, or null. */
export function takeReason(plan: PayPlan | null, slots: Task[], reviewer: string, owner: string): string | null {
  if (!plan) return "This project has no paid reviews.";
  if (reviewer.toLowerCase() === owner.toLowerCase()) return "You cannot review your own project.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(reviewer)) return "Open FAVOUR in World App to take a paid review.";
  if (slots.some((t) => t.claimant?.toLowerCase() === reviewer.toLowerCase())) return "You already hold a slot on this project.";
  if (slots.length >= plan.slots) return "Every paid slot on this project is taken.";
  return null;
}

/** The sum and the dates a builder sees BEFORE confirming in World App. */
export type FundSummary = {
  count: number;
  perReviewUsd: number;
  totalUsd: number;
  /** Earliest date on which an unapproved slot in this batch refunds to the builder. */
  refundAfter: string;
  lines: string[];
};

export function fundSummary(plan: PayPlan, unfunded: Array<Pick<Task, "deadline">>, nowMs: number): FundSummary {
  const count = unfunded.length;
  const totalUsd = count * plan.perReviewUsd;
  const earliest = unfunded.length
    ? Math.min(...unfunded.map((t) => Number(escrowV2DeadlineFor(t.deadline, nowMs)) * 1000))
    : nowMs + (PAY_SLOT_HOURS * 3600 + ESCROW_V2_CONFIRM_GRACE_S) * 1000;
  const refundAfter = new Date(earliest).toISOString();
  return {
    count,
    perReviewUsd: plan.perReviewUsd,
    totalUsd,
    refundAfter,
    lines: [
      `${count} ${count === 1 ? "review" : "reviews"} at ${plan.perReviewUsd} USDC each: ${totalUsd} USDC from your wallet.`,
      "Each review is its own escrow, bound to that reviewer. FAVOUR never holds it.",
      "You release each one yourself after you read the review.",
      `A review you do not approve refunds to you after ${shortDate(refundAfter)}.`,
    ],
  };
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the deadline";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The ONE World App confirm that funds every taken, unfunded slot: a single
 *  Permit2 approve for the total, then one fundWithPermit2 per slot. Permit2's
 *  approve with expiration 0 lives for this block only and its amount is
 *  decremented by each transferFrom (Uniswap permit2, Allowance.sol), so K pulls
 *  that sum to the approved total go through in one transaction. Same contract,
 *  same calls the old board makes one at a time (escrow-v2.ts buildFundTransactions). */
export function buildFundBatch(
  slots: Array<{ taskId: string; recipient: `0x${string}`; usd: number; deadline: bigint }>,
): MiniKitTxPayload | null {
  if (!escrowV2Enabled() || slots.length === 0) return null;
  const escrow = escrowV2Address();
  const total = slots.reduce((sum, s) => sum + usdToUnits(s.usd), BigInt(0));
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      {
        to: PERMIT2_ADDRESS,
        data: encodeFunctionData({ abi: PERMIT2_APPROVE_ABI, functionName: "approve", args: [USDC_ADDRESS, escrow, total, 0] }),
      },
      ...slots.map((s) => ({
        to: escrow,
        data: encodeFunctionData({
          abi: ESCROW_V2_ABI,
          functionName: "fundWithPermit2",
          args: [escrowV2TaskId(s.taskId), getAddress(s.recipient.toLowerCase()), usdToUnits(s.usd), s.deadline],
        }),
      })),
    ],
  };
}

export function paySlotDescription(productName: string, ask: string): string {
  return `Paid review of ${productName}. ${ask}`.slice(0, 600);
}
