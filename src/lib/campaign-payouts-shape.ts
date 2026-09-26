// Client-safe shape of a PIECE PAYOUT: the payment state of one accepted piece of a
// company campaign. The store logic lives in campaign-payouts.ts (server only).
//
// THE STATES (2026-09-27, the company-to-paid-outcome path):
//   pending  the company accepted the piece. Money has not moved. `reason` says
//            why: the pool is not funded yet, or it is funded and the payout
//            itself is waiting on Oscar (wallet, custody, fee are HELD).
//   paid     an operator recorded a transfer hash after reading it on World Chain.
//            No HTTP route can write this state. scripts/mark-piece-paid.mjs only.
//   failed   the piece cannot be paid from this pool: the accepted pieces already
//            commit the whole pool (pool_exhausted), or the operator recorded a
//            failed payout attempt (payout_failed).

import type { PieceKind } from "./campaign-draft-shape";

export type PayoutStatus = "pending" | "paid" | "failed";
export type PayoutReason = "pool_unfunded" | "awaiting_payout" | "pool_exhausted" | "payout_failed";

export type PiecePayout = {
  // The id of the reviewed result the company accepted. One payout per result.
  id: string;
  campaignId: string;
  taskId: string;
  kind: PieceKind | null;
  // Shortened address, what the company sees. The full address lives in a private
  // key on the server and is never in this object.
  participant: string;
  amountUsdc: number;
  status: PayoutStatus;
  reason?: PayoutReason;
  acceptedAt: string;
  paidAt?: string;
  paidTxHash?: string;
  failedAt?: string;
  // True when the record was written outside production. Test data says so.
  test?: true;
};

// HELD FOR OSCAR: how a pool splits across pieces. The default here is the
// company's own two numbers, pool divided by the pieces it asked for, rounded down
// to a cent. No fee is taken from this share (the fee in campaign-funding-shape
// sits on top of the pool and is itself unruled).
export function piecePayoutUsdc(poolUsdc: number, totalPieces: number): number {
  if (!Number.isFinite(poolUsdc) || !Number.isFinite(totalPieces) || totalPieces < 1 || poolUsdc <= 0) return 0;
  return Math.floor((Math.round(poolUsdc * 100) / totalPieces)) / 100;
}

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "Payment pending",
  paid: "Paid",
  failed: "Payment failed",
};

export const PAYOUT_REASON_LABEL: Record<PayoutReason, string> = {
  pool_unfunded: "The company has not funded the pool yet.",
  awaiting_payout: "The pool is funded. The payout waits for FAVOUR to send it.",
  pool_exhausted: "The accepted pieces already use the whole pool.",
  payout_failed: "The transfer did not go through. FAVOUR will retry.",
};
