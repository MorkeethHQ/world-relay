import { describe, it, expect, beforeEach, vi } from "vitest";

// Repro + guard for the stale-claimantVerification bug (found 2026-07-15).
//
// verify-proof/route.ts:138 loads `const task` ONCE and never reassigns it. On the
// direct-submit path (the app's main "Do it" flow, and in practice the ONLY flow:
// prod event log shows 5 task_claimed vs 649 proof_submitted) the task is still
// `open`, so task.claimantVerification is null. :205 calls submitProof(), which
// sets the level on its OWN copy and persists it, but the route DISCARDS the
// return value. Three later reads then use the stale null:
//
//   :282  vLevel  = task.claimantVerification || ...      -> reasoning label + multiplier
//   :373  recordCampaignCompletion({ ...task })            -> the $2 unlock gate
//   :399  recordCompletion(..., task.claimantVerification) -> rep.verificationLevel
//
// Live damage confirmed before the fix:
//   unlock:* keys in prod                     = 0   (the gate NEVER passed once)
//   Orb wallets with rep.verificationLevel=orb= 0 / 33  (leaderboard mis-sorted:
//                                                    getTrustScore gives orb +0.3)
//
// The correct value is already in scope as `claimantLevel` (:166), which falls
// back to a live Address Book lookup via submitterLevel.
//
// An earlier fix (b84d349, Jul 5) made the level reach the STORE and its comment
// at :161-163 claims the bug is fixed. It never fixed the objects handed to the
// unlock and the reputation. That is why this test asserts on the CONSUMERS, not
// on submitProof.

const recordCampaignCompletionCalls: any[] = [];
const recordCompletionCalls: any[] = [];

const OPEN_TASK = {
  id: "t-open",
  poster: "agent:relay",
  claimant: null,
  claimantVerification: null, // the crux: null while status is "open"
  status: "open",
  description: "Post about FAVOUR in your own words",
  location: "Paris",
  bountyUsdc: 10,
  rewardType: "points",
  campaignId: "say-it-out-loud",
  onChainId: null,
  escrowTxHash: null,
  lat: null,
  lng: null,
  proofImageUrl: null,
  proofImages: null,
  verificationResult: null,
  createdAt: new Date().toISOString(),
};

vi.mock("@/lib/store", () => ({
  getTask: async () => ({ ...OPEN_TASK }),
  submitProof: async () => ({ ...OPEN_TASK, status: "submitted", claimantVerification: "orb" }),
  completeTask: async () => ({ ...OPEN_TASK }),
  setAttestationHash: async () => {},
  setFollowUp: async () => {},
  spawnRecurringTask: async () => null,
  markSettled: async () => {},
  markSettlementPending: async () => {},
}));

// The submitter IS Orb-verified on-chain. This is the ground truth the route must
// propagate; it is exactly what claimantLevel resolves to via submitterLevel.
vi.mock("@/lib/verification-tier", () => ({
  getUserVerificationLevel: async () => "orb",
  tierGateError: async () => null,
}));

vi.mock("@/lib/campaign-unlock", () => ({
  recordCampaignCompletion: async (task: any) => {
    recordCampaignCompletionCalls.push(task);
    return { counted: true, unlockTx: null };
  },
}));

vi.mock("@/lib/reputation", () => ({
  recordCompletion: async (...args: any[]) => {
    recordCompletionCalls.push(args);
    return { currentStreak: 1, verificationLevel: args[3] };
  },
  recordFailure: async () => ({}),
  getReputation: async () => ({
    address: "0xorb", tasksCompleted: 0, tasksFailed: 0, avgConfidence: 0,
    totalEarnedUsdc: 0, totalPointsEarned: 0, verificationLevel: "wallet",
    currentStreak: 0, longestStreak: 0, lastActiveAt: new Date().toISOString(),
  }),
  getTrustScore: () => 0.5,
  getVerificationMultiplier: () => 1,
}));

vi.mock("@/lib/verify-proof", () => ({
  verifyProof: async () => ({ verdict: "pass", confidence: 0.9, reasoning: "ok" }),
  verifyProofConsensus: async () => ({ verdict: "pass", confidence: 0.9, reasoning: "ok", models: [] }),
  verifyProofStub: () => ({ verdict: "pass", confidence: 0.9, reasoning: "ok" }),
}));

vi.mock("@/lib/image-upload", () => ({ uploadProofImage: async () => "https://img/1.jpg" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: async () => null, resolveDon: async () => null }));
vi.mock("@/lib/notifications", () => ({
  notifyProofSubmitted: async () => {}, notifyVerified: async () => {},
  notifyFlagged: async () => {}, notifyPaymentReleased: async () => {},
}));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/xmtp", () => ({
  postProofSubmitted: async () => {}, postVerificationResult: async () => {},
  postSettlementConfirmation: async () => {}, postFollowUpQuestion: async () => {},
  syncAndProcessMessages: async () => {},
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async () => null }));
vi.mock("@/lib/ai-chat", () => ({ generateFollowUpQuestion: async () => null, generateClaimBriefing: async () => null }));
vi.mock("@/lib/referral", () => ({ recordReferralActivation: async () => {} }));
vi.mock("@/lib/proof-of-favour", () => ({
  recordFavourAttempted: async () => {}, recordFavourCompleted: async () => {},
  recordFavourFailed: async () => {}, completionPointsFor: () => 10,
}));
vi.mock("@/lib/campaigns", () => ({
  getCampaign: () => ({
    id: "say-it-out-loud",
    unlock: { requiresOrb: true, unlockThreshold: 1, unlockAmount: 2, pot: 10, maxCountedPerUser: 1 },
  }),
}));

import { POST } from "@/app/api/verify-proof/route";

function req(body: any) {
  return new Request("http://localhost/api/verify-proof", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  recordCampaignCompletionCalls.length = 0;
  recordCompletionCalls.length = 0;
});

const submit = () =>
  POST(req({
    taskId: "t-open",
    submitter: "0xorbhuman000000000000000000000000000000001",
    proofImages: ["data:image/jpeg;base64,AAAA"],
    proofNote: "did it",
  }));

describe("direct submit from `open`: the Orb level must reach every consumer", () => {
  it(":373 the unlock gate receives claimantVerification=orb (NOT the stale null)", async () => {
    await submit();
    expect(recordCampaignCompletionCalls).toHaveLength(1);
    // Before the fix this is null, campaign-unlock.ts:139 returns none, and the
    // $2 unlock silently never fires. That is the live prod bug: unlock:* = 0 keys.
    expect(recordCampaignCompletionCalls[0].claimantVerification).toBe("orb");
  });

  it(":399 reputation is recorded with verificationLevel=orb (NOT undefined)", async () => {
    await submit();
    expect(recordCompletionCalls).toHaveLength(1);
    // args: (address, bountyUsdc, confidence, verificationLevel, isFundedTask)
    // Before the fix this is undefined, so rep.verificationLevel stays "wallet"
    // and getTrustScore withholds the orb +0.3. Live: 0 of 33 Orb wallets correct.
    expect(recordCompletionCalls[0][3]).toBe("orb");
  });
});
