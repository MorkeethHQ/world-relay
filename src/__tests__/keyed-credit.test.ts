import { describe, it, expect, beforeEach, vi } from "vitest";

// KEYED CREDITS (2026-10-05). LOCAL DOUBLE: an in-memory stand-in for Redis.
// A credit written with a `ref` stores the ref in the same write as the credit,
// so a second call with that ref changes nothing. A call with no ref behaves as
// it always did, which is what every live route does.
const kv = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, v); return "OK"; },
    get: async (k: string) => kv.get(k) ?? null,
    del: async (k: string) => { kv.delete(k); return 1; },
    sadd: async () => 1,
    zincrby: async () => 1,
    eval: async (_s: string, keys: string[], args: string[]) => { if (kv.get(keys[0]) === args[0]) { kv.delete(keys[0]); return 1; } return 0; },
  }),
}));

import { recordFavourCompleted, recordFavourAttempted, hasPointsCreditRef, CREDIT_REFS_MAX } from "@/lib/proof-of-favour";
import { recordCompletion, hasReputationCreditRef, forgetReputation } from "@/lib/reputation";

const ANA = `0x${"a1".repeat(20)}`;
const pof = () => JSON.parse(kv.get(`pof:${ANA}`)!);
const rep = () => JSON.parse(kv.get(`rep:${ANA}`)!);

beforeEach(() => { kv.clear(); forgetReputation(ANA); });

describe("points ledger", () => {
  it("the same ref credits once", async () => {
    await recordFavourCompleted(ANA, 0, 18, "recheck:t1:completed");
    await recordFavourCompleted(ANA, 0, 18, "recheck:t1:completed");
    expect(pof()).toMatchObject({ totalPoints: 18, favoursCompleted: 1 });
    expect(await hasPointsCreditRef(ANA, "recheck:t1:completed")).toBe(true);
    expect(await hasPointsCreditRef(ANA, "recheck:t2:completed")).toBe(false);
  });

  it("a different ref credits again, and no ref behaves as before (every call counts)", async () => {
    await recordFavourCompleted(ANA, 0, 18, "recheck:t1:completed");
    await recordFavourCompleted(ANA, 0, 12, "recheck:t2:completed");
    await recordFavourCompleted(ANA, 0, 5);
    await recordFavourCompleted(ANA, 0, 5);
    expect(pof()).toMatchObject({ totalPoints: 40, favoursCompleted: 4 });
    expect(pof().creditRefs).toEqual(["recheck:t1:completed", "recheck:t2:completed"]);
  });

  it("the attempt stat is keyed the same way", async () => {
    await recordFavourAttempted(ANA, "recheck:t1:attempted");
    await recordFavourAttempted(ANA, "recheck:t1:attempted");
    expect(pof().favoursAttempted).toBe(1);
  });

  it("the read-back is false for a person with no profile and the ref list is bounded", async () => {
    expect(await hasPointsCreditRef(ANA, "x")).toBe(false);
    for (let i = 0; i < CREDIT_REFS_MAX + 5; i++) await recordFavourAttempted(ANA, `r${i}`);
    expect(pof().creditRefs).toHaveLength(CREDIT_REFS_MAX);
  });
});

describe("reputation", () => {
  it("the same ref records one completion, and the read-back reads the store, not the per-process copy", async () => {
    await recordCompletion(ANA, 18, 0.9, "orb", false, "recheck:t1");
    await recordCompletion(ANA, 18, 0.9, "orb", false, "recheck:t1");
    expect(rep()).toMatchObject({ tasksCompleted: 1, totalPointsEarned: 18 });
    expect(await hasReputationCreditRef(ANA, "recheck:t1")).toBe(true);
    // The store loses the row; the module still holds its own copy.
    kv.delete(`rep:${ANA}`);
    expect(await hasReputationCreditRef(ANA, "recheck:t1")).toBe(false);
  });

  it("no ref behaves as before", async () => {
    await recordCompletion(ANA, 5, 0.9);
    await recordCompletion(ANA, 5, 0.9);
    expect(rep()).toMatchObject({ tasksCompleted: 2, totalPointsEarned: 10 });
    expect(rep().creditRefs).toBeUndefined();
  });
});
