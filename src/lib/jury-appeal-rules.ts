import type { Task } from "./types";
import { isRealMoney, isFunded } from "./reward";

// The reviewer thresholds, in a file with no server imports, so a client
// component can show them. jury-appeal.ts re-exports these; there is one value
// of each.
export const APPEAL_QUORUM = 3;
export const APPEAL_CLEAR_MAJORITY = 2;
export const JUDGE_MIN_GRADED = 10;
export const JUDGE_MIN_ACCURACY = 0.6;

/**
 * The single gate that keeps a human verdict away from money.
 *
 * A proof is appealable ONLY if it is AI-flagged, carries an image to judge,
 * pays points, and touches no escrow, no on-chain id, no Double-or-Nothing and
 * no campaign. Every one of those exclusions maps to an invariant: money is
 * AI-verified only (Inv 2), campaign progress comes only from the pass path
 * (Inv 8), one escrow funds one payout (Inv 6).
 */
export function isAppealable(t: Task): boolean {
  return (
    t.verificationResult?.verdict === "flag" &&
    !!t.proofImageUrl &&
    !!t.claimant &&
    t.rewardType === "points" &&
    !isRealMoney(t) &&
    // isFunded, NOT hasOnChainEscrow. hasOnChainEscrow is the strict CREDIT
    // signal: it demands a real 0x+64hex tx hash, so a task carrying an
    // onChainId with no hash yet reads false — and as a refusal gate that
    // silently let an escrow-bound task through (caught by this module's guard
    // test on the first run). reward.ts says it outright: leaning loose only
    // adds protection for a gate, and is wrong only for crediting. Refuse on
    // the loosest possible signal.
    !isFunded(t) &&
    t.donOnChainId === null &&
    !t.campaignId &&
    !t.escrowV2Address
  );
}
