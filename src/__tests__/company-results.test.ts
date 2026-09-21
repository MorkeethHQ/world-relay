import { describe, it, expect, beforeEach, vi } from "vitest";

// The company sees its pieces reviewed (FAVOUR-COMPANY-JOURNEY-2026-09-21): a pass
// or a fail on a published company campaign piece is recorded with the reason and a
// shortened participant, and nothing about it reaches money.

const recordFavourCompletedCalls: any[] = [];
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
  listTasks: async () => [],
}));
let verdict: "pass" | "fail" = "pass";
vi.mock("@/lib/verify-proof", () => ({
  verifyProof: async () => ({ verdict, confidence: 0.95, reasoning: verdict === "pass" ? "Link shows a real clip about the product" : "The link is a stock video, not made for this" }),
  verifyProofConsensus: async () => ({ verdict, confidence: 0.95, reasoning: "ok", models: [] }),
  verifyProofStub: async () => ({ verdict, confidence: 0.95, reasoning: "ok" }),
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/verification-tier", () => ({ tierGateError: async () => null, getUserVerificationLevel: async () => "orb" }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));
vi.mock("@/lib/campaign-unlock", () => ({ recordCampaignCompletion: async () => ({ counted: false, unlockTx: null }) }));
vi.mock("@/lib/proof-of-favour", () => ({
  recordFavourAttempted: async () => {},
  recordFavourCompleted: async (...args: any[]) => { recordFavourCompletedCalls.push(args); },
  recordFavourFailed: async () => {},
  completionPointsFor: () => 9, streakBonusFor: (streak: number) => streak,
}));
vi.mock("@/lib/reputation", async (orig) => {
  const actual = await (orig() as Promise<any>);
  return {
    ...actual,
    recordCompletion: async () => ({ address: "0x", tasksCompleted: 1, totalEarnedUsdc: 0, totalPointsEarned: 0, verificationLevel: "orb" }),
    recordFailure: async () => ({}),
    getReputation: async () => ({ address: "0x", tasksCompleted: 0, tasksFailed: 0, totalEarnedUsdc: 0, totalPointsEarned: 0, avgConfidence: 0, verificationLevel: "orb", lastActiveAt: new Date().toISOString(), currentStreak: 0, longestStreak: 0 }),
  };
});
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



const results: any[] = [];
vi.mock("@/lib/campaign-drafts", () => ({
  getPublishedCampaign: async (id: string) => ({ id, company: "Example company", pieceTaskIds: { ugc: "piece-ugc" } }),
  kindOfTask: (c: any, taskId: string) => (c.pieceTaskIds.ugc === taskId ? "ugc" : null),
  recordCampaignResult: async (id: string, r: any) => { results.push({ id, ...r }); },
  shortAddress: (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`,
}));
vi.mock("@/lib/completions", async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, checkCompletedTask: async () => "no", claimCompletionSlot: async () => "claimed", recordTaskCompletion: async () => {} };
});

import { POST } from "@/app/api/verify-proof/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const CLAIMANT = "0xcccccccccccccccccccccccccccccccccccccccc";
const POSTER = "0x2222222222222222222222222222222222222222";
function piece(over: Record<string, any> = {}) {
  return {
    id: "piece-ugc", poster: POSTER, claimant: null, category: "social", companyCampaignId: "draft_x",
    description: "Example company campaign · A short UGC clip.", location: "Online",
    lat: null, lng: null, bountyUsdc: 10, deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null,
    recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 5, completionCount: 0,
    createdAt: new Date().toISOString(), ...over,
  };
}
const submit = () => POST(new Request("http://localhost/api/verify-proof", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${issueSessionToken(CLAIMANT, Date.now())}` },
  body: JSON.stringify({ taskId: "piece-ugc", submitter: CLAIMANT, proofNote: "https://example.test/my-clip" }),
}) as any);

beforeEach(() => {
  results.length = 0; recordFavourCompletedCalls.length = 0; verdict = "pass"; storedTask = piece();
  process.env.SESSION_SECRET = "test-secret"; process.env.ANTHROPIC_API_KEY = "test-key"; delete process.env.OPENROUTER_API_KEY;
});

describe("the company sees accepted and rejected pieces, with the reason", () => {
  it("an accepted piece is recorded for the company, and the participant earns points", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "draft_x", taskId: "piece-ugc", kind: "ugc", verdict: "pass" });
    expect(results[0].reason).toMatch(/real clip/);
    expect(results[0].participant).not.toBe(CLAIMANT);
    expect(recordFavourCompletedCalls).toHaveLength(1);
  });

  it("a rejected piece is recorded with why, and earns nothing", async () => {
    verdict = "fail";
    await submit();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ verdict: "fail" });
    expect(results[0].reason).toMatch(/stock video/);
    expect(recordFavourCompletedCalls).toHaveLength(0);
  });

  it("an ordinary favour with no company campaign records nothing for a company", async () => {
    storedTask = piece({ companyCampaignId: undefined });
    await submit();
    expect(results).toHaveLength(0);
  });
});
