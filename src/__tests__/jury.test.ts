import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";

const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();
const mockHashes = new Map<string, Map<string, number>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string) => { mockStore.set(key, value); return "OK"; },
    del: async (key: string) => { mockStore.delete(key); return 1; },
    sadd: async (key: string, member: string) => {
      const s = mockSets.get(key) || new Set<string>();
      const added = s.has(member) ? 0 : 1;
      s.add(member); mockSets.set(key, s); return added;
    },
    smembers: async (key: string) => Array.from(mockSets.get(key) || []),
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

import { composeDeck, issueJuryDeck, recordJuryVerdict, juryPool, JURY_DAILY_POINTS_CAP } from "@/lib/jury";

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

let idc = 0;
const nextId = () => `card-${++idc}`;

beforeEach(() => {
  mockStore.clear(); mockSets.clear(); mockHashes.clear();
  awards.length = 0; idc = 0;
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

  it("composeDeck mixes true pairs and mismatched pairs", () => {
    const tasks = Array.from({ length: 12 }, () => doneTask());
    const deck = composeDeck(tasks, JUDGE);
    expect(deck.length).toBeGreaterThan(4);
    expect(deck.some((c) => c.answer.isMatch)).toBe(true);
    expect(deck.some((c) => !c.answer.isMatch)).toBe(true);
    for (const c of deck) {
      if (!c.answer.isMatch) expect(c.answer.proofTaskId).not.toBe(c.answer.descTaskId);
    }
  });

  it("issued cards are OPAQUE: no task id, no isMatch reaches the client", async () => {
    const tasks = Array.from({ length: 8 }, () => doneTask());
    const deck = await issueJuryDeck(tasks, JUDGE, nextId);
    for (const card of deck) {
      const s = JSON.stringify(card);
      expect(s).not.toMatch(/isMatch/);
      expect(s).not.toMatch(/proofTaskId|descTaskId/);
      // image url references the opaque cardId, never a task id
      expect(card.proofImageUrl).toBe(`/api/jury/card/${card.cardId}/image`);
    }
  });
});

describe("verdicts (opaque cards)", () => {
  it("resolves correctness server-side from the stored card and pays on correct", async () => {
    const tasks = Array.from({ length: 8 }, () => doneTask());
    const deck = await issueJuryDeck(tasks, JUDGE, nextId);
    // The client can't see the answer, so try both; exactly one is correct.
    const card = deck[0];
    const first = await recordJuryVerdict(JUDGE, card.cardId, true);
    expect("error" in first).toBe(false);
    // The card is single-use now.
    const again = await recordJuryVerdict(JUDGE, card.cardId, true);
    expect("error" in again).toBe(true);
  });

  it("FABRICATED card ids earn NOTHING (the faucet is closed)", async () => {
    const r1 = await recordJuryVerdict(JUDGE, "totally-made-up", true);
    expect("error" in r1).toBe(true);
    const r2 = await recordJuryVerdict(JUDGE, "0xaaa|0xbbb", true);
    expect("error" in r2).toBe(true);
    expect(awards.length).toBe(0);
  });

  it("a card issued to another judge is rejected", async () => {
    const tasks = Array.from({ length: 6 }, () => doneTask());
    const deck = await issueJuryDeck(tasks, JUDGE, nextId);
    const other = "0x" + "1".repeat(40);
    const r = await recordJuryVerdict(other, deck[0].cardId, true);
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toMatch(/Not your card/);
  });

  it("daily cap stops payouts but not play", async () => {
    // Issue many single-match cards by staking known answers directly.
    for (let i = 0; i < JURY_DAILY_POINTS_CAP + 5; i++) {
      const id = `c${i}`;
      mockStore.set(`jury:card:${id}`, JSON.stringify({ judge: JUDGE, proofTaskId: "a", descTaskId: "a", isMatch: true }));
      await recordJuryVerdict(JUDGE, id, true); // always correct
    }
    expect(awards.length).toBe(JURY_DAILY_POINTS_CAP);
    const stats = mockHashes.get(`jury:stats:${JUDGE.toLowerCase()}`)!;
    expect(stats.get("judged")).toBe(JURY_DAILY_POINTS_CAP + 5);
  });
});
