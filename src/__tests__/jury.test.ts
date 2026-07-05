import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";

const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();
const mockHashes = new Map<string, Map<string, number>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    sadd: async (key: string, member: string) => {
      const s = mockSets.get(key) || new Set<string>();
      const added = s.has(member) ? 0 : 1;
      s.add(member); mockSets.set(key, s); return added;
    },
    smembers: async (key: string) => [...(mockSets.get(key) || [])],
    incr: async (key: string) => {
      const next = Number(mockStore.get(key) || 0) + 1;
      mockStore.set(key, next); return next;
    },
    expire: async () => 1,
    hincrby: async (key: string, field: string, by: number) => {
      const h = mockHashes.get(key) || new Map<string, number>();
      h.set(field, (h.get(field) || 0) + by); mockHashes.set(key, h);
      return h.get(field)!;
    },
    hget: async (key: string, field: string) => mockHashes.get(key)?.get(field) ?? null,
  }),
}));

const awards: Array<{ address: string; points: number }> = [];
vi.mock("@/lib/proof-of-favour", () => ({
  awardPoints: async (address: string, _action: string, points: number) => {
    awards.push({ address, points });
    return {};
  },
}));

import { buildJuryDeck, isMatchKey, recordJuryVerdict, juryPool, JURY_DAILY_POINTS_CAP } from "@/lib/jury";

const JUDGE = "0x" + "9".repeat(40);

let seq = 0;
function doneTask(overrides: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `jt${seq}`,
    poster: "agent:relay",
    claimant: "0x" + String(seq).padStart(40, "0"),
    category: "photo",
    description: `proofable favour number ${seq} with a proper spec`,
    location: "Anywhere",
    lat: null, lng: null,
    bountyUsdc: 5,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "completed",
    proofImageUrl: `data:image/jpeg;base64,x${seq}`,
    proofImages: null,
    proofNote: "did it",
    verificationResult: { verdict: "pass", reasoning: "ok", confidence: 0.9 },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null,
    callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null,
    taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: "wallet", requiresClaim: false,
    pendingRelease: false, maxCompletions: 1, completionCount: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

beforeEach(() => {
  mockStore.clear(); mockSets.clear(); mockHashes.clear();
  awards.length = 0;
});

describe("deck building", () => {
  it("pool excludes own proofs, non-passed, and imageless tasks", () => {
    const mine = doneTask({ claimant: JUDGE });
    const flagged = doneTask({ verificationResult: { verdict: "flag", reasoning: "?", confidence: 0.5 } });
    const noImage = doneTask({ proofImageUrl: null });
    const good = doneTask();
    const pool = juryPool([mine, flagged, noImage, good], JUDGE);
    expect(pool.map((t) => t.id)).toEqual([good.id]);
  });

  it("deck mixes true pairs and mismatched pairs, keys decode correctly", () => {
    const tasks = Array.from({ length: 12 }, () => doneTask());
    const deck = buildJuryDeck(tasks, JUDGE, new Set(), 12);
    expect(deck.length).toBeGreaterThan(4);
    const matches = deck.filter((c) => isMatchKey(c.key)!.isMatch);
    const mismatches = deck.filter((c) => !isMatchKey(c.key)!.isMatch);
    expect(matches.length).toBeGreaterThan(0);
    expect(mismatches.length).toBeGreaterThan(0);
    // Mismatched cards must show a DIFFERENT task's description.
    for (const c of mismatches) {
      const { proofTaskId, descTaskId } = isMatchKey(c.key)!;
      expect(proofTaskId).not.toBe(descTaskId);
    }
    // Proof image always points at the API image route, never inline base64.
    for (const c of deck) expect(c.proofImageUrl).toMatch(/^\/api\/tasks\/.+\/proof-image/);
  });

  it("seen cards never come back", () => {
    const tasks = Array.from({ length: 6 }, () => doneTask());
    const first = buildJuryDeck(tasks, JUDGE, new Set(), 10);
    const seen = new Set(first.map((c) => c.key));
    const second = buildJuryDeck(tasks, JUDGE, seen, 10);
    expect(second.length).toBe(0);
  });
});

describe("verdicts", () => {
  it("correct verdict pays 1 pt, double-vote on the same card is rejected", async () => {
    const r1 = await recordJuryVerdict(JUDGE, "a|a", true);
    expect("error" in r1).toBe(false);
    if (!("error" in r1)) {
      expect(r1.correct).toBe(true);
      expect(r1.pointsAwarded).toBe(1);
    }
    const r2 = await recordJuryVerdict(JUDGE, "a|a", true);
    expect("error" in r2).toBe(true);
    expect(awards.length).toBe(1);
  });

  it("wrong verdict pays nothing but counts as judged", async () => {
    const r = await recordJuryVerdict(JUDGE, "a|b", true); // said match, was mismatch
    if (!("error" in r)) {
      expect(r.correct).toBe(false);
      expect(r.pointsAwarded).toBe(0);
      expect(r.judged).toBe(1);
    }
    expect(awards.length).toBe(0);
  });

  it("daily cap stops payouts but not play", async () => {
    for (let i = 0; i < JURY_DAILY_POINTS_CAP + 5; i++) {
      await recordJuryVerdict(JUDGE, `t${i}|t${i}`, true);
    }
    expect(awards.length).toBe(JURY_DAILY_POINTS_CAP);
    const stats = mockHashes.get(`jury:stats:${JUDGE.toLowerCase()}`)!;
    expect(stats.get("judged")).toBe(JURY_DAILY_POINTS_CAP + 5);
  });
});
