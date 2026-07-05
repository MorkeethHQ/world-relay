import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();
const mockHashes = new Map<string, Map<string, string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    del: async (key: string) => { mockStore.delete(key); return 1; },
    sadd: async (key: string, member: string) => {
      const s = mockSets.get(key) || new Set<string>();
      const added = s.has(member) ? 0 : 1;
      s.add(member); mockSets.set(key, s); return added;
    },
    smembers: async (key: string) => [...(mockSets.get(key) || [])],
    hget: async (key: string, field: string) => mockHashes.get(key)?.get(field) ?? null,
    hset: async (key: string, obj: Record<string, string>) => {
      const h = mockHashes.get(key) || new Map<string, string>();
      for (const [f, v] of Object.entries(obj)) h.set(f, v);
      mockHashes.set(key, h); return 1;
    },
    hsetnx: async (key: string, field: string, value: string) => {
      const h = mockHashes.get(key) || new Map<string, string>();
      if (h.has(field)) return 0;
      h.set(field, value); mockHashes.set(key, h); return 1;
    },
    hdel: async (key: string, field: string) => { mockHashes.get(key)?.delete(field); return 1; },
    hgetall: async (key: string) => Object.fromEntries(mockHashes.get(key) || new Map()),
  }),
}));

const balances = new Map<string, number>();
const ledger: Array<{ wallet: string; action: string; amount: number }> = [];
vi.mock("@/lib/proof-of-favour", () => ({
  spendPoints: async (address: string, action: string, amount: number) => {
    const bal = balances.get(address) ?? 0;
    if (bal < amount) return { ok: false, error: "Not enough points" };
    balances.set(address, bal - amount);
    ledger.push({ wallet: address, action, amount: -amount });
    return { ok: true, totalPoints: bal - amount };
  },
  awardPoints: async (address: string, action: string, amount: number) => {
    balances.set(address, (balances.get(address) ?? 0) + amount);
    ledger.push({ wallet: address, action, amount });
    return {};
  },
}));

import { createPrediction, placeStake, resolvePrediction, getStakes, poolsFrom, PREDICTION_MIN_STAKE } from "@/lib/predictions";

const W = (n: number) => ("0x" + String(n).padStart(40, "0"));
const NOW = new Date("2026-07-10T12:00:00Z").getTime();
const FUTURE = "2026-07-19T18:00:00Z";
const PAST = "2026-07-01T00:00:00Z";
const AFTER_LOCK = new Date("2026-07-20T00:00:00Z").getTime();

beforeEach(() => {
  mockStore.clear(); mockSets.clear(); mockHashes.clear();
  balances.clear(); ledger.length = 0;
});

async function makeOpen() {
  return createPrediction({ question: "Who wins?", options: ["A", "B", "C"], locksAt: FUTURE, creator: "favour" });
}

describe("staking", () => {
  it("deducts points immediately and records the stake", async () => {
    const p = await makeOpen();
    balances.set(W(1), 100);
    const r = await placeStake(p.id, W(1), "A", 20, NOW);
    expect(r.ok).toBe(true);
    expect(balances.get(W(1))).toBe(80);
    const stakes = await getStakes(p.id);
    expect(stakes[W(1).toLowerCase()]).toEqual({ option: "A", amount: 20 });
  });

  it("one stake per wallet, band enforced, options validated, no overdraft", async () => {
    const p = await makeOpen();
    balances.set(W(1), 100);
    await placeStake(p.id, W(1), "A", 20, NOW);
    expect((await placeStake(p.id, W(1), "B", 10, NOW)).error).toMatch(/already staked/);
    expect((await placeStake(p.id, W(2), "A", PREDICTION_MIN_STAKE - 1, NOW)).error).toMatch(/Stake must be/);
    expect((await placeStake(p.id, W(2), "Z", 10, NOW)).error).toMatch(/Unknown option/);
    balances.set(W(3), 3);
    expect((await placeStake(p.id, W(3), "A", 10, NOW)).ok).toBe(false);
    expect(balances.get(W(3))).toBe(3); // nothing deducted on failure
  });

  it("locks at locksAt", async () => {
    const p = await createPrediction({ question: "q", options: ["A", "B"], locksAt: PAST, creator: "favour" });
    balances.set(W(1), 100);
    expect((await placeStake(p.id, W(1), "A", 10, NOW)).error).toMatch(/locked/);
  });
});

describe("resolution", () => {
  it("winners split the WHOLE pool pro-rata", async () => {
    const p = await makeOpen();
    balances.set(W(1), 100); balances.set(W(2), 100); balances.set(W(3), 100);
    await placeStake(p.id, W(1), "A", 30, NOW); // winner
    await placeStake(p.id, W(2), "A", 10, NOW); // winner
    await placeStake(p.id, W(3), "B", 40, NOW); // loser
    const r = await resolvePrediction(p.id, "A", AFTER_LOCK);
    expect(r).toMatchObject({ ok: true, paid: 2 });
    // total pool 80, winning pool 40: W1 gets 80*30/40=60, W2 gets 80*10/40=20
    expect(balances.get(W(1))).toBe(70 + 60);
    expect(balances.get(W(2))).toBe(90 + 20);
    expect(balances.get(W(3))).toBe(60); // lost the 40
  });

  it("no winners -> everyone refunded; VOID -> everyone refunded", async () => {
    const p = await makeOpen();
    balances.set(W(1), 50); balances.set(W(2), 50);
    await placeStake(p.id, W(1), "A", 10, NOW);
    await placeStake(p.id, W(2), "B", 20, NOW);
    const r = await resolvePrediction(p.id, "C", AFTER_LOCK);
    expect(r.refunded).toBe(2);
    expect(balances.get(W(1))).toBe(50);
    expect(balances.get(W(2))).toBe(50);

    const p2 = await makeOpen();
    await placeStake(p2.id, W(1), "A", 10, NOW);
    await resolvePrediction(p2.id, "VOID");
    expect(balances.get(W(1))).toBe(50);
  });

  it("resolution is idempotent and validates the outcome", async () => {
    const p = await makeOpen();
    balances.set(W(1), 100);
    await placeStake(p.id, W(1), "A", 10, NOW);
    expect((await resolvePrediction(p.id, "NOT_AN_OPTION", AFTER_LOCK)).ok).toBe(false);
    expect((await resolvePrediction(p.id, "A", AFTER_LOCK)).ok).toBe(true);
    const again = await resolvePrediction(p.id, "A", AFTER_LOCK);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/Already resolved/);
    // Paid exactly once: 100 - 10 + 10 (sole winner takes own pool back)
    expect(balances.get(W(1))).toBe(100);
  });

  it("stakes after resolution are rejected", async () => {
    const p = await makeOpen();
    balances.set(W(1), 100);
    await resolvePrediction(p.id, "VOID");
    expect((await placeStake(p.id, W(1), "A", 10, NOW)).error).toMatch(/locked/);
  });
});

describe("pools", () => {
  it("poolsFrom sums per option including empty ones", () => {
    const pools = poolsFrom(
      { a: { option: "A", amount: 5 }, b: { option: "A", amount: 10 }, c: { option: "B", amount: 7 } },
      ["A", "B", "C"]
    );
    expect(pools).toEqual({ A: 15, B: 7, C: 0 });
  });
});
