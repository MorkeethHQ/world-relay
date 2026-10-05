// WHICH FLAGGED PROOFS QUALIFIED REVIEWERS MAY DECIDE (2026-10-05). Pure, and
// safe to import from a client component, so the proof screen and the server
// read ONE gate.
//
// isAppealable (jury-appeal-rules.ts) is frozen: a photo, points, no campaign.
// This is a second gate beside it, for the three kinds of flagged proof that
// had no person who could decide them, all on favours FAVOUR itself posted:
//
//   welcome_instance  a per-person Welcome instance, photo or written
//   welcome_source    an original Welcome favour still held by an earlier
//                     person's flagged proof (8 such rows on production, 5 Oct)
//   house_text        a written answer on a plain house favour (28 held, 5 Oct)
//
// WHAT IT REFUSES, and each line is checked on the STORED row, never on a label
// a client sent:
//   - anything not posted by a house agent ("agent:"). A favour a person posted
//     is decided by that person.
//   - anything with money on it: a reward that is not points, an escrow hash, an
//     on-chain id, a Double or Nothing stake, an escrow-v2 address. The loosest
//     signals are used, because a refusal gate leans loose.
//   - any campaign except the Welcome campaign while it has no cash unlock. So a
//     campaign that pays USDC (campaign-unlock.ts) can never be reached.
//   - a company piece (it has its own source-bound review).
//   - a proof whose sender is not a wallet (a preview or test identity).
//   - a proof the frozen photo appeal already takes. One proof, one path.
import type { Task } from "./types";
import { isFunded, isRealMoney } from "./reward";
import { isAppealable } from "./jury-appeal-rules";
import { WELCOME_CAMPAIGN_ID, WELCOME_ORIGINAL_STEPS, welcomeCampaign } from "./welcome-shape";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export type HouseReviewScope = "welcome_instance" | "welcome_source" | "house_text";

export function houseReviewScope(t: Task, now: number = Date.now()): HouseReviewScope | null {
  if (t.verificationResult?.verdict !== "flag" || t.status !== "claimed" || !t.claimant) return null;
  // The sender must be a wallet. A dev_, demo_ or e2e_ identity can hold no
  // points, so a "cleared" decision for one could never be credited and would
  // ask for a retry for ever. Such rows exist in the store (isPublicTask hides
  // them from the board), so they are refused here and never dealt.
  if (!WALLET_RE.test(t.claimant)) return null;
  if (!t.proofImageUrl && !t.proofNote?.trim()) return null;
  if (typeof t.poster !== "string" || !t.poster.startsWith("agent:")) return null;
  if (t.hiddenAt || t.companyCampaignId) return null;
  if (
    t.rewardType !== "points" || isRealMoney(t) || isFunded(t) || t.donOnChainId != null ||
    t.taskType === "double-or-nothing" || !!t.escrowV2Address
  ) return null;

  if (t.campaignId) {
    if (t.campaignId !== WELCOME_CAMPAIGN_ID || welcomeCampaign(now) === null) return null;
    if (!WELCOME_ORIGINAL_STEPS.includes(t.description)) return null;
    if (t.welcomeFor || t.welcomeSourceId) {
      return t.welcomeFor && t.welcomeSourceId && t.claimant.toLowerCase() === t.welcomeFor ? "welcome_instance" : null;
    }
    // The original shared row, held by the earlier person who claimed it.
    return (t.maxCompletions ?? 1) > 1 ? "welcome_source" : null;
  }
  if (t.welcomeFor || t.welcomeSourceId) return null;
  // A photo on a plain favour belongs to the frozen photo appeal.
  if (isAppealable(t)) return null;
  return "house_text";
}

// The favour as it would stand if this proof were flagged, for the proof screen,
// which holds the favour BEFORE the proof is sent.
export function asIfFlagged(t: Task, claimant: string | null, hasPhoto: boolean, hasNote: boolean): Task {
  return {
    ...t,
    status: "claimed",
    claimant: t.welcomeFor ?? claimant ?? t.claimant ?? "0x0000000000000000000000000000000000000000",
    proofSubmissionId: "pending",
    proofImageUrl: hasPhoto ? "pending" : null,
    proofImages: hasPhoto ? ["pending"] : null,
    proofNote: hasNote ? "pending" : null,
    verificationResult: { verdict: "flag", reasoning: "", confidence: 0 },
  };
}
