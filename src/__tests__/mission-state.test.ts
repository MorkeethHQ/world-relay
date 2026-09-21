import { describe, it, expect, beforeEach, vi } from "vitest";

// FAVOUR-MISSION-STATE-MOBILE-2026-09-21. A completed mission stops being an action.
//
// The defect, read at the object: completeTask resets a multi-completion favour to
// `open` and clears its claimant and proof on every pass, so nothing recorded WHO
// completed it. The daily mission (maxCompletions 100) therefore stayed actionable
// for the person who had just done it, and the same wallet could complete it again
// and again. These tests pin the record, the refusal, and the private read path.

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
vi.mock("@/lib/campaign-unlock", () => ({ recordCampaignCompletion: async (t: any) => { campaignCalls.push(t); return { counted: false, unlockTx: null }; } }));
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


const recorded: Array<{ address: string; c: any }> = [];
let check: "yes" | "no" | "unknown" = "no";
let slot: "claimed" | "duplicate" | "unknown" = "claimed";
const campaignCalls: any[] = [];
vi.mock("@/lib/completions", async (orig) => {
  const actual = await (orig() as Promise<any>);
  return {
    ...actual,
    checkCompletedTask: async () => check,
    claimCompletionSlot: async () => slot,
    recordTaskCompletion: async (address: string, c: any) => { recorded.push({ address, c }); },
  };
});

import { POST as VERIFY_POST } from "@/app/api/verify-proof/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { buildContribution, NOTE_MAX } from "@/lib/completions";

const CLAIMANT = "0xcccccccccccccccccccccccccccccccccccccccc";
const POSTER = "0x2222222222222222222222222222222222222222";

function task(over: Record<string, any> = {}) {
  return {
    id: "mission-1", poster: POSTER, claimant: null, category: "social",
    description: "what does today smell like where you are?", location: "Anywhere",
    lat: null, lng: null, bountyUsdc: 9, deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null,
    recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 100, completionCount: 3,
    createdAt: new Date().toISOString(), ...over,
  };
}

const submit = (body: Record<string, any> = {}) =>
  VERIFY_POST(new Request("http://localhost/api/verify-proof", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${issueSessionToken(CLAIMANT, Date.now())}`,
    },
    body: JSON.stringify({ taskId: "mission-1", submitter: CLAIMANT, proofNote: "Wet tarmac and bread.", proofImages: ["AAAA"], ...body }),
  }) as any);

beforeEach(() => {
  recordFavourCompletedCalls.length = 0;
  recorded.length = 0;
  campaignCalls.length = 0;
  check = "no";
  slot = "claimed";
  storedTask = task();
  process.env.SESSION_SECRET = "test-secret";
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;
});

describe("a pass leaves a record the reset cannot erase", () => {
  it("records who passed, the points written, and the proof link", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].address).toBe(CLAIMANT);
    expect(recorded[0].c.taskId).toBe("mission-1");
    expect(recorded[0].c.points).toBe((await res.json()).pointsAwarded);
    expect(recorded[0].c.proofImageUrl).toBe("https://example.test/p.jpg");
    expect(recorded[0].c.proofNote).toBe("Wet tarmac and bread.");
  });
});

describe("one pass per person on a favour many people may complete", () => {
  it("refuses a second completion with 409 before any credit is written", async () => {
    check = "yes";
    const res = await submit();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_completed");
    expect(recordFavourCompletedCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("does not touch a single-completion favour, whose claimant already guards it", async () => {
    check = "yes";
    slot = "duplicate";
    storedTask = task({ maxCompletions: 1, completionCount: 0 });
    const res = await submit();
    expect(res.status).toBe(200);
  });
});

describe("the guard fails CLOSED and holds under concurrency (review, 2026-09-21)", () => {
  it("refuses with 503 when the record cannot be read, and writes nothing", async () => {
    // An earlier draft failed OPEN here. During a persistent outage that would have
    // allowed unbounded repeat passes. Watched red against that draft.
    check = "unknown";
    const res = await submit();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("completion_check_unavailable");
    expect(recordFavourCompletedCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("a concurrent duplicate that loses the atomic claim gets NO credit of any kind", async () => {
    // Both requests pass the pre-check (it ran before either wrote), the AI passes
    // both, and only one can win the SADD. The loser must write no points, no
    // display row and no campaign credit.
    slot = "duplicate";
    storedTask = task({ campaignId: "say-it-out-loud" });
    const res = await submit();
    expect(res.status).toBe(200);
    expect(recordFavourCompletedCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
    expect(campaignCalls).toHaveLength(0);
  });

  it("an unreadable store at claim time also writes no credit, including the USDC-capable unlock", async () => {
    slot = "unknown";
    storedTask = task({ campaignId: "say-it-out-loud" });
    await submit();
    expect(recordFavourCompletedCalls).toHaveLength(0);
    expect(campaignCalls).toHaveLength(0);
  });

  it("the winner of the claim is credited once, campaign included", async () => {
    storedTask = task({ campaignId: "say-it-out-loud" });
    await submit();
    expect(recordFavourCompletedCalls).toHaveLength(1);
    expect(campaignCalls).toHaveLength(1);
  });

  it("two truly parallel submissions are serialised by the per-task verify lock", async () => {
    // Pin that the lock this guard relies on is still taken before any work. If
    // someone removes it, concurrency protection rests on the SADD alone.
    const src = (await import("fs")).readFileSync((await import("path")).join(__dirname, "../app/api/verify-proof/route.ts"), "utf8");
    const lockAt = src.indexOf("lock:verify:");
    const checkAt = src.indexOf("checkCompletedTask(");
    const claimAt = src.indexOf("claimCompletionSlot(");
    const unlockAt = src.indexOf("recordCampaignCompletion(");
    const pointsAt = src.indexOf("recordFavourCompleted(");
    expect(lockAt).toBeGreaterThan(0);
    expect(lockAt).toBeLessThan(checkAt);
    expect(claimAt).toBeLessThan(unlockAt);
    expect(claimAt).toBeLessThan(pointsAt);
    expect(src).toMatch(/set\(verifyLock, "1", \{ nx: true/);
  });
});

describe("the real claim is atomic against a real set", () => {
  it("SADD lets exactly one of two concurrent claims win", async () => {
    const { claimCompletionSlot: realClaim } = await vi.importActual<any>("@/lib/completions");
    const set = new Set<string>();
    // A store whose SADD behaves like Redis: returns 1 only for the caller that added.
    const fake = { sadd: async (_k: string, m: string) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); if (set.has(m)) return 0; set.add(m); return 1; } };
    const redisMod = await import("@/lib/redis");
    const spy = vi.spyOn(redisMod, "getRedis").mockReturnValue(fake as any);
    const results = await Promise.all(Array.from({ length: 10 }, () => realClaim("mission-1", CLAIMANT)));
    spy.mockRestore();
    expect(results.filter((r: string) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r: string) => r === "duplicate")).toHaveLength(9);
  });

  it("a SADD that throws is 'unknown', never 'claimed'", async () => {
    const { claimCompletionSlot: realClaim, checkCompletedTask: realCheck } = await vi.importActual<any>("@/lib/completions");
    const redisMod = await import("@/lib/redis");
    const broken = { sadd: async () => { throw new Error("down"); }, sismember: async () => { throw new Error("down"); } };
    const spy = vi.spyOn(redisMod, "getRedis").mockReturnValue(broken as any);
    expect(await realClaim("mission-1", CLAIMANT)).toBe("unknown");
    expect(await realCheck("mission-1", CLAIMANT)).toBe("unknown");
    spy.mockRestore();
  });
});

describe("buildContribution keeps what is safe to show back", () => {
  it("never stores an inline data: image, which can be megabytes and dies with the task row", () => {
    const c = buildContribution({ taskId: "t", description: "d", points: 9, streakBonus: 0, proofImageUrl: "data:image/jpeg;base64,AAAA", proofNote: null, now: 0 });
    expect(c.proofImageUrl).toBeNull();
  });

  it("caps a pasted wall of text rather than storing it whole", () => {
    const c = buildContribution({ taskId: "t", description: "x".repeat(20_000), points: 9, streakBonus: 0, proofImageUrl: null, proofNote: "y".repeat(20_000), now: 0 });
    expect(c.description.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(c.proofNote!.length).toBeLessThanOrEqual(NOTE_MAX);
  });
});

describe("an AI-made decoy can never be paid as a completion", () => {
  it("verify-proof on a decoy id finds no task: 404, and nothing is credited", async () => {
    storedTask = null; // decoys are constants in lib/decoys.ts, never tasks
    const res = await VERIFY_POST(new Request("http://localhost/api/verify-proof", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${issueSessionToken(CLAIMANT, Date.now())}` },
      body: JSON.stringify({ taskId: "decoy:smell", submitter: CLAIMANT, proofNote: "Wet concrete and jasmine." }),
    }) as any);
    expect(res.status).toBe(404);
    expect(recordFavourCompletedCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });
});
