import { describe, it, expect, beforeEach, vi } from "vitest";

// THE GATE ON THE ROUTES THAT WRITE POINTS, 2026-09-20.
//
// The night assignment: "Enforce session ownership on every points-writing route
// used by this journey", and the acceptance: "Unauthorized write fails".
//
// What was measured on production before this file existed:
//   POST /api/verify-proof took `submitter` straight off the request body, with no
//   session read anywhere in the route, and on a passing verdict wrote points to
//   that address via recordFavourCompleted. So anyone could earn as anybody.
//   POST /api/jury called ownershipError, which honours SESSION_ENFORCE, and that
//   switch has shipped OFF for months, so the gate was dormant in production: an
//   anonymous POST was answered 409 by the store rather than 403 by the gate.
//
// These routes are now gated UNCONDITIONALLY, the way /api/daily already was. The
// switch is deliberately not in the path: an invariant whose gate is an env var
// can be disabled rather than violated, which is how this sat open (see the
// 2026-09-16 ruling recorded in SECURITY-INVARIANTS.md).
//
// Watched red before the gate was written: with no cookie, verify-proof reached
// the credit path and jury answered 409.

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
vi.mock("@/lib/jury", () => ({
  issueJuryDeck: async () => [],
  recordJuryVerdict: async () => ({ correct: true, pointsAwarded: 1 }),
}));

import { POST as VERIFY_POST } from "@/app/api/verify-proof/route";
import { POST as JURY_POST } from "@/app/api/jury/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const CLAIMANT = "0xcccccccccccccccccccccccccccccccccccccccc";
const OTHER = "0x1111111111111111111111111111111111111111";
const POSTER = "0x2222222222222222222222222222222222222222";

function task(over: Record<string, any> = {}) {
  return {
    id: "t1", poster: POSTER, claimant: null, category: "social",
    description: "what does today smell like where you are?", location: "Anywhere",
    lat: null, lng: null, bountyUsdc: 9, deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null,
    recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 500, completionCount: 0,
    createdAt: new Date().toISOString(), ...over,
  };
}

function post(url: string, body: any, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) }) as any;
}

const verify = (submitter: string, cookie?: string) =>
  VERIFY_POST(post("http://localhost/api/verify-proof", { taskId: "t1", submitter, proofNote: "Wet tarmac and bread." }, cookie));
const jury = (address: string, cookie?: string) =>
  JURY_POST(post("http://localhost/api/jury", { address, cardId: "c1", verdict: "match" }, cookie));

beforeEach(() => {
  recordFavourCompletedCalls.length = 0;
  storedTask = task();
  process.env.SESSION_SECRET = "test-secret";
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;
  // The gate must NOT depend on this switch. Left explicitly off in every case
  // below, which is the production value, so a green run here is a claim about
  // production rather than about a flag nobody has flipped.
  delete process.env.SESSION_ENFORCE;
});

describe("POST /api/verify-proof proves the session owner", () => {
  it("refuses an anonymous submission and writes no points", async () => {
    const res = await verify(CLAIMANT);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
    expect(recordFavourCompletedCalls).toHaveLength(0);
  });

  it("refuses a session acting as a DIFFERENT wallet", async () => {
    const res = await verify(CLAIMANT, issueSessionToken(OTHER, Date.now())!);
    expect(res.status).toBe(403);
    expect(recordFavourCompletedCalls).toHaveLength(0);
  });

  it("refuses an unsigned dev_ identity, and names the fix that exists", async () => {
    // wallet_required, not reauth_required. A browser-preview identity cannot hold
    // a session at any point in the future, so telling it to sign in again is a
    // loop with no exit. The client shows the World App handoff for this code.
    const res = await verify("dev_abc123");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("wallet_required");
    expect(recordFavourCompletedCalls).toHaveLength(0);
  });

  it("lets the wallet that owns the session through, and it earns", async () => {
    const res = await verify(CLAIMANT, issueSessionToken(CLAIMANT, Date.now())!);
    expect(res.status).toBe(200);
    expect(recordFavourCompletedCalls).toHaveLength(1);
    expect(recordFavourCompletedCalls[0][0]).toBe(CLAIMANT);
  });

  it("reports the EXACT points it wrote, so the screen cannot disagree with history", async () => {
    // The pass screen used to re-derive the advertised bounty and render that. It
    // silently omitted the streak bonus, so a returning person saw one number on
    // the result and a larger one in History. The route now reports what it wrote.
    const res = await verify(CLAIMANT, issueSessionToken(CLAIMANT, Date.now())!);
    const body = await res.json();
    const written = recordFavourCompletedCalls[0][2];
    expect(body.pointsAwarded).toBe(written + body.streakBonus);
    expect(body.pointsAwarded).toBeGreaterThan(0);
  });

  it("refuses an EXPIRED session rather than treating it as absent-and-fine", async () => {
    const stale = issueSessionToken(CLAIMANT, Date.now() - 400 * 24 * 3600_000)!;
    const res = await verify(CLAIMANT, stale);
    expect(res.status).toBe(403);
    expect(recordFavourCompletedCalls).toHaveLength(0);
  });
});

describe("POST /api/jury proves the session owner without SESSION_ENFORCE", () => {
  it("refuses an anonymous verdict", async () => {
    const res = await jury(CLAIMANT);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
  });

  it("refuses a verdict cast as another wallet", async () => {
    const res = await jury(CLAIMANT, issueSessionToken(OTHER, Date.now())!);
    expect(res.status).toBe(403);
  });

  it("accepts the session owner's own verdict", async () => {
    const res = await jury(CLAIMANT, issueSessionToken(CLAIMANT, Date.now())!);
    expect(res.status).toBe(200);
  });
});
