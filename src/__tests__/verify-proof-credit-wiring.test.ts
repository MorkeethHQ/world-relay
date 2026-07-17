import { describe, it, expect, beforeEach, vi } from "vitest";

// WIRING guard for the dollar-credit signal.
//
// earned-usdc-credit.test.ts covers the RULE (reward.ts's isRealMoney +
// hasOnChainEscrow). This file covers the WIRING: that verify-proof actually
// hands the STRICT signal to recordCompletion. Without it, someone can restore
// `recordCompletion(..., taskIsFunded)` and every rule test stays green while
// points start banking as dollars again — the exact "guard that doesn't guard"
// shape called out in SECURITY-INVARIANTS.md, and the reason
// tasks-route-privilege.test.ts exists alongside seeder.test.ts.
//
// What it pins: a POINTS task carrying a real escrow tx must credit points, never
// USDC. That combination is what the old loose signal got wrong.
//
// Verified by mutation: `const taskIsRealMoney = taskIsFunded` turns the first
// case red (isFundedTask true), while earned-usdc-credit.test.ts stays green.

const recordCompletionCalls: any[] = [];
let storedTask: any = null;

vi.mock("@/lib/store", () => ({
  getTask: async () => storedTask,
  submitProof: async (_id: string, _n: any, _i: any, level: any) => ({ ...storedTask, claimantVerification: level }),
  completeTask: async () => storedTask,
  setAttestationHash: async () => {},
  setFollowUp: async () => {},
  spawnRecurringTask: async () => null,
  markSettled: async () => {},
  markSettlementPending: async () => {},
}));

vi.mock("@/lib/reputation", async (orig) => {
  const actual = await (orig() as Promise<any>);
  return {
    ...actual,
    recordCompletion: async (...args: any[]) => {
      recordCompletionCalls.push(args);
      return { address: args[0], tasksCompleted: 1, totalEarnedUsdc: 0, totalPointsEarned: 0, verificationLevel: "orb" };
    },
    recordFailure: async () => ({}),
    getReputation: async () => ({ address: "0x", tasksCompleted: 0, tasksFailed: 0, totalEarnedUsdc: 0, totalPointsEarned: 0, avgConfidence: 0, verificationLevel: "orb", lastActiveAt: new Date().toISOString(), currentStreak: 0, longestStreak: 0 }),
  };
});

// Verdict is forced to a clean pass so the credit path is reached.
vi.mock("@/lib/verify-proof", () => ({
  verifyProof: async () => ({ verdict: "pass", confidence: 0.95, reasoning: "ok" }),
  verifyProofConsensus: async () => ({ verdict: "pass", confidence: 0.95, reasoning: "ok", models: [] }),
  verifyProofStub: async () => ({ verdict: "pass", confidence: 0.95, reasoning: "ok" }),
}));

vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/verification-tier", () => ({ tierGateError: async () => null, getUserVerificationLevel: async () => "orb" }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));
vi.mock("@/lib/campaign-unlock", () => ({ recordCampaignCompletion: async () => ({ counted: false, unlockTx: null }) }));
vi.mock("@/lib/proof-of-favour", () => ({ recordFavourAttempted: async () => {}, recordFavourCompleted: async () => {}, recordFavourFailed: async () => {}, completionPointsFor: () => 10 }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: async () => null, resolveDon: async () => null }));
vi.mock("@/lib/xmtp", () => ({ postProofSubmitted: async () => {}, postVerificationResult: async () => {}, postFollowUpQuestion: async () => {}, postSettlementConfirmation: async () => {}, syncAndProcessMessages: async () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateFollowUpQuestion: async () => null }));
vi.mock("@/lib/notifications", () => ({ notifyProofSubmitted: async () => {}, notifyVerified: async () => {}, notifyFlagged: async () => {}, notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async () => null }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/image-upload", () => ({ uploadProofImage: async () => "https://example.test/p.jpg" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/referral", () => ({ recordReferralActivation: async () => {} }));

import { POST } from "@/app/api/verify-proof/route";

const CLAIMANT = "0xcccccccccccccccccccccccccccccccccccccccc";
const POSTER = "0xpppppppppppppppppppppppppppppppppppppppp";
const REAL_TX = `0x${"a".repeat(64)}`;

function task(over: Record<string, any> = {}) {
  return {
    id: "t1", poster: POSTER, claimant: null, category: "social",
    description: "Post about FAVOUR in your own words", location: "Anywhere",
    lat: null, lng: null, bountyUsdc: 10, deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null,
    recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 500, completionCount: 0,
    createdAt: new Date().toISOString(), ...over,
  };
}

const req = (body: any) =>
  new Request("http://localhost/api/verify-proof", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as any;

const submit = () => POST(req({ taskId: "t1", submitter: CLAIMANT, proofNote: "https://x.com/me/status/1 — posted it" }));
const isFundedArg = () => recordCompletionCalls[0]?.[4];

beforeEach(() => {
  recordCompletionCalls.length = 0;
  storedTask = null;
  // The route picks its verifier from env at REQUEST time:
  //   useRealVerification = !!ANTHROPIC_API_KEY && withinLimit
  //   useConsensus        = useRealVerification && !!OPENROUTER_API_KEY && moneyAtStake
  // With neither key it takes the safe-mode branch and FLAGS, so the credit path
  // is never reached and every case here would pass vacuously. Set one key (and
  // clear the other) so the mocked single-model verifier returns the clean pass.
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;
});

describe("verify-proof hands the STRICT signal to recordCompletion", () => {
  it("a POINTS task carrying a real escrow tx credits POINTS, not dollars", async () => {
    // The old signal (onChainId != null || !!escrowTxHash) says "funded" here and
    // would bank this task's bountyUsdc (a POINTS value of 10) as $10.
    storedTask = task({ rewardType: "points", onChainId: 1, escrowTxHash: REAL_TX });
    await submit();
    // Guard against a vacuous pass: if the route flagged instead of crediting,
    // isFundedArg() would be undefined and "not true" would look like success.
    expect(recordCompletionCalls).toHaveLength(1);
    expect(isFundedArg()).toBe(false);
  });

  it('a "funded" PLACEHOLDER hash never credits dollars', async () => {
    storedTask = task({ rewardType: "usdc", bountyUsdc: 5, onChainId: 1, escrowTxHash: "funded" });
    await submit();
    expect(isFundedArg()).toBe(false);
  });

  it("an onChainId with no escrow tx never credits dollars", async () => {
    storedTask = task({ rewardType: "usdc", bountyUsdc: 5, onChainId: 7, escrowTxHash: null });
    await submit();
    expect(isFundedArg()).toBe(false);
  });

  it("a genuinely escrow-funded USDC task DOES credit dollars", async () => {
    storedTask = task({ rewardType: "usdc", bountyUsdc: 5, onChainId: 1, escrowTxHash: REAL_TX });
    await submit();
    expect(isFundedArg()).toBe(true);
  });

  it("a plain points task credits points", async () => {
    storedTask = task({ rewardType: "points", bountyUsdc: 10 });
    await submit();
    expect(isFundedArg()).toBe(false);
  });
});
