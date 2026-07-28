import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkSeedCap, recordSeededEarn, isSeededTask, SEEDED_FUNDED_DAILY_CAP,
  SEEDED_POINTS_DAILY_CAP } from "@/lib/seed-caps";
import { isTemplateCopy, MIN_DESCRIPTION_LENGTH, POST_TEMPLATES } from "@/lib/post-templates";
import type { Task } from "@/lib/types";

// Mock Redis with an in-memory implementation for tests
const mockStore = new Map<string, string | number>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    incr: async (key: string) => {
      const next = Number(mockStore.get(key) || 0) + 1;
      mockStore.set(key, next);
      return next;
    },
    expire: async () => 1,
  }),
}));

beforeEach(() => {
  mockStore.clear();
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    poster: "agent:relay",
    claimant: null,
    category: "review",
    description: "Review a coffee shop near you.",
    location: "Online",
    lat: null,
    lng: null,
    bountyUsdc: 1,
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: { id: "relay", name: "RELAY", icon: "", color: "" } as unknown as Task["agent"],
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    claimantVerification: null,
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1,
    completionCount: 0,
    createdAt: new Date().toISOString(),
    settlementTx: null,
    campaignId: null,
    ...overrides,
  } as Task;
}

const WALLET = "0x3648B7f52f8f1dFf9C412C032271cF3f386b4443";

describe("isSeededTask", () => {
  it("treats agent-posted tasks as seeded", () => {
    expect(isSeededTask(makeTask({}))).toBe(true);
  });
  it("treats user wallet posts as not seeded", () => {
    expect(isSeededTask(makeTask({ poster: WALLET, agent: null }))).toBe(false);
  });
});

describe("seed caps", () => {
  it("allows user-posted tasks regardless of history", async () => {
    const userTask = makeTask({ poster: "0xabcdef1234", agent: null, onChainId: 7, escrowTxHash: "0xhash" });
    for (let i = 0; i < 10; i++) await recordSeededEarn(userTask, WALLET);
    expect((await checkSeedCap(userTask, WALLET)).allowed).toBe(true);
  });

  it("blocks a wallet after the funded seeded cap in one day", async () => {
    const funded = makeTask({ onChainId: 26, escrowTxHash: "0xescrow", rewardType: "usdc" });
    for (let i = 0; i < SEEDED_FUNDED_DAILY_CAP; i++) {
      expect((await checkSeedCap(funded, WALLET)).allowed).toBe(true);
      await recordSeededEarn(funded, WALLET);
    }
    const blocked = await checkSeedCap(funded, WALLET);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toMatch(/tomorrow/i);
  });

  it("tracks funded and points caps separately", async () => {
    const funded = makeTask({ onChainId: 26, escrowTxHash: "0xescrow", rewardType: "usdc" });
    const points = makeTask({});
    for (let i = 0; i < SEEDED_FUNDED_DAILY_CAP; i++) await recordSeededEarn(funded, WALLET);
    expect((await checkSeedCap(funded, WALLET)).allowed).toBe(false);
    expect((await checkSeedCap(points, WALLET)).allowed).toBe(true);
  });

  it("blocks points seeded tasks after the points cap", async () => {
    const points = makeTask({});
    for (let i = 0; i < SEEDED_POINTS_DAILY_CAP; i++) {
      expect((await checkSeedCap(points, WALLET)).allowed).toBe(true);
      await recordSeededEarn(points, WALLET);
    }
    expect((await checkSeedCap(points, WALLET)).allowed).toBe(false);
  });

  it("caps are per wallet", async () => {
    const funded = makeTask({ onChainId: 26, escrowTxHash: "0xescrow", rewardType: "usdc" });
    await recordSeededEarn(funded, WALLET);
    expect((await checkSeedCap(funded, "0x9999999999999999999999999999999999999999")).allowed).toBe(true);
  });
});

describe("template copy rejection", () => {
  it("rejects every template verbatim", () => {
    for (const t of POST_TEMPLATES) expect(isTemplateCopy(t.desc)).toBe(true);
  });
  it("rejects template copy with whitespace/case tweaks", () => {
    expect(isTemplateCopy("  go to a place NEARBY and review it honestly.   Photo your experience and rate it. ")).toBe(true);
  });
  it("accepts real user descriptions", () => {
    expect(isTemplateCopy("Review the best cheap eat within 10 minutes of you. Photo the dish.")).toBe(false);
  });
  it("min length keeps out near-empty posts", () => {
    expect("hi".length).toBeLessThan(MIN_DESCRIPTION_LENGTH);
    expect("Walk my dog for 20 minutes".length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_LENGTH);
  });
});

  // The churn moment must hand the user a door, not just a wall. A daily cap is
  // not retryable — without a next action the most engaged user in the app gets
  // a "Try Again" that fails identically until midnight. Judging is the only
  // surface that cannot run out of supply, which is why it is the destination.
  it("offers judging as the next action when the cap is hit", async () => {
    const task = makeTask({});
    for (let i = 0; i < SEEDED_POINTS_DAILY_CAP; i++) await recordSeededEarn(task, WALLET);
    const res = await checkSeedCap(task, WALLET);
    expect(res.allowed).toBe(false);
    expect(res.nextAction, "a capped user needs somewhere to go").toBe("jury");
    expect(res.message).toMatch(/judge/i);
    expect(res.message, "still tell them when it resets").toMatch(/tomorrow/i);
  });
