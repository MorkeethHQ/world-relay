import { getRedis } from "./redis";
import type { Campaign } from "./campaigns";
import { REQUESTER_CAMPAIGN_POLICY, validateRequesterCampaignPolicy } from "./campaign-store";

// ---------------------------------------------------------------------------
// RUN THIS AGAIN (2026-09-09, O1B).
//
// The loop the product was missing: a requester reads the round that just
// finished, runs the same useful work again with an edited brief, and a
// returning participant sees exactly what changed before deciding.
//
// This file owns the DRAFT of the next round and nothing else. Three rules
// govern it, and they are what keep the feature honest:
//
//  1. A draft is NOT an obligation. It creates no task, opens no work, funds
//     nothing and promises nobody a reward. It is labelled DRAFT wherever it
//     appears, and no participant surface may offer an action on it.
//  2. Points only, by construction. Requester campaigns are points-only policy
//     (campaign-store.ts REQUESTER_CAMPAIGN_POLICY) and a draft is validated
//     against that same policy. There is no field here that can carry USDC, a
//     bounty, an escrow or a pot, and assertNoMoneyFields refuses input that
//     tries. Whether a repeat round may ever pay cash is a decision for Oscar,
//     not a default this file invents.
//  3. Points are never described as cash. reward.ts owns the labels.
// ---------------------------------------------------------------------------

const DRAFT_PREFIX = "campaign_round_draft:";

export type RoundDraft = {
  campaignId: string;
  // The round this draft WOULD become. Round 1 is the campaign as launched.
  round: number;
  ask: string;
  completion: string[];
  proof: string;
  repeats: string;
  rewardPoints: number;
  completionsPerCycle: number;
  // There is deliberately no other value for this field.
  status: "draft";
  author: string;
  createdAt: string;
  updatedAt: string;
};

export type RoundChange = { field: string; label: string; before: string; after: string };

// Money can never enter a round draft. Rejecting the input is louder than
// ignoring it: a caller that sends a bounty gets told no, rather than quietly
// having it dropped and assuming it worked.
const MONEY_FIELDS = ["bountyUsdc", "rewardType", "rewardKind", "usdc", "pot", "unlock", "escrow", "funded"];

export function assertNoMoneyFields(input: Record<string, unknown>): string | null {
  for (const field of MONEY_FIELDS) {
    if (input[field] !== undefined) {
      return `A repeat round is points-only. Remove "${field}".`;
    }
  }
  return null;
}

// What round 1 said. A draft is always a diff against this.
export function roundBaseline(campaign: Campaign): Omit<RoundDraft, "campaignId" | "round" | "status" | "author" | "createdAt" | "updatedAt"> {
  return {
    ask: campaign.commission?.asks ?? campaign.description,
    completion: campaign.commission?.completion ?? [],
    proof: campaign.commission?.proof ?? "",
    repeats: campaign.commission?.repeats ?? "",
    rewardPoints: campaign.rewardPerTask,
    completionsPerCycle: campaign.cadence?.completionsPerCycle ?? 0,
  };
}

export function buildRoundDraft(
  campaign: Campaign,
  round: number,
  author: string,
  edits: Partial<Pick<RoundDraft, "ask" | "completion" | "proof" | "repeats" | "rewardPoints" | "completionsPerCycle">>,
  now = new Date(),
  existing?: RoundDraft | null,
): RoundDraft {
  const base = roundBaseline(campaign);
  return {
    campaignId: campaign.id,
    round,
    ask: edits.ask ?? base.ask,
    completion: edits.completion ?? base.completion,
    proof: edits.proof ?? base.proof,
    repeats: edits.repeats ?? base.repeats,
    rewardPoints: edits.rewardPoints ?? base.rewardPoints,
    completionsPerCycle: edits.completionsPerCycle ?? base.completionsPerCycle,
    status: "draft",
    author,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// Exactly what changed, for the returning participant. Nothing else is shown as
// a change, and an unchanged field is absent rather than listed as "same".
export function diffRoundDraft(campaign: Campaign, draft: RoundDraft): RoundChange[] {
  const base = roundBaseline(campaign);
  const changes: RoundChange[] = [];
  const push = (field: string, label: string, before: string, after: string) => {
    if (before.trim() !== after.trim()) changes.push({ field, label, before, after });
  };
  push("ask", "What is being asked", base.ask, draft.ask);
  push("proof", "Proof required", base.proof, draft.proof);
  push("repeats", "Why it repeats", base.repeats, draft.repeats);
  push("completion", "What counts as done", base.completion.join(" / "), draft.completion.join(" / "));
  push("rewardPoints", "Points per verified favour", String(base.rewardPoints), String(draft.rewardPoints));
  push("completionsPerCycle", "People wanted this round", String(base.completionsPerCycle), String(draft.completionsPerCycle));
  return changes;
}

export function validateRoundDraft(draft: Pick<RoundDraft, "ask" | "completion" | "proof" | "repeats" | "rewardPoints" | "completionsPerCycle">, campaign: Campaign): string | null {
  if (!draft.ask || draft.ask.trim().length < 20) return "The ask must be at least 20 characters.";
  if (!draft.proof.trim()) return "Say what proof is required.";
  if (!draft.repeats.trim()) return "Say why this round repeats.";
  if (draft.completion.length === 0) return "Say what counts as done.";
  // The SAME policy the campaign was created under. A repeat round may not
  // escape the bounds the first round was held to.
  return validateRequesterCampaignPolicy({
    rewardPoints: draft.rewardPoints,
    completionsPerCycle: draft.completionsPerCycle,
    intervalHours: campaign.cadence?.intervalHours ?? REQUESTER_CAMPAIGN_POLICY.minIntervalHours,
    totalCycles: campaign.cadence?.totalCycles ?? REQUESTER_CAMPAIGN_POLICY.minCycles,
  });
}

// ---------------------------------------------------------------------------
// Who may act, and who may only look.
//
// A draft is never actionable by anybody. On top of that, a wallet that has
// already been accepted on the current round may not be offered that round
// again: the store keeps one completion per wallet per task
// (COMPLETED_CLAIMANTS in store.ts) and this is the same rule stated on the
// screen instead of only at the moment of submission.
// ---------------------------------------------------------------------------

export type RoundOffer = {
  actionable: false;
  reason: string;
  detail: string;
};

const TEST_IDENTITY = /^(dev_|demo_|e2e_)/;

export function roundOffer(input: {
  draftExists: boolean;
  round: number;
  wallet: string | null;
  completedCurrentRound: boolean;
}): RoundOffer {
  if (!input.draftExists) {
    return { actionable: false, reason: "No next round", detail: "The requester has not drafted another round." };
  }
  if (!input.wallet) {
    return {
      actionable: false,
      reason: "Draft, and you are signed out",
      detail: `Round ${input.round} is a draft. Nothing is open to do yet, and we cannot check whether you already did the last round until you sign in.`,
    };
  }
  if (TEST_IDENTITY.test(input.wallet)) {
    return {
      actionable: false,
      reason: "Preview identity",
      detail: "Preview accounts are never offered real work. Sign in with a wallet.",
    };
  }
  if (input.completedCurrentRound) {
    return {
      actionable: false,
      reason: "You already did this round",
      detail: `Your proof for round ${input.round - 1} was accepted, and a wallet is accepted once per round. Round ${input.round} is still a draft, so there is nothing to do yet.`,
    };
  }
  return {
    actionable: false,
    reason: "Draft",
    detail: `Round ${input.round} is a draft. It opens only when the requester publishes it, and nothing is claimable until then.`,
  };
}

// ---------------------------------------------------------------------------
// Storage. One draft per campaign, overwritten by the owner.
// ---------------------------------------------------------------------------

export async function saveRoundDraft(draft: RoundDraft): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Round storage is unavailable");
  await redis.set(`${DRAFT_PREFIX}${draft.campaignId}`, JSON.stringify(draft));
}

export async function getRoundDraft(campaignId: string): Promise<RoundDraft | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${DRAFT_PREFIX}${campaignId}`);
  if (!raw) return null;
  const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as RoundDraft;
  // Anything read back is a draft, whatever the record claims.
  return { ...parsed, status: "draft" };
}
