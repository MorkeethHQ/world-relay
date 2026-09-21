import { describe, it, expect, beforeEach, vi } from "vitest";

// REPLENISH WITH A QUALITY GATE (2026-09-21). Oscar: "we need to have infinite
// ones", on top of the 16 Sep kill for stale, samey favours. These pin the gate.

const kv = new Map<string, any>();
const sets = new Map<string, Set<string>>();
const fakeRedis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: any) => { kv.set(k, v); return "OK"; },
  incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, n); return n; },
  incrby: async (k: string, by: number) => { const n = Number(kv.get(k) ?? 0) + by; kv.set(k, n); return n; },
  expire: async () => 1,
  sadd: async (k: string, m: string) => { const s = sets.get(k) ?? new Set(); s.add(m); sets.set(k, s); return 1; },
  smembers: async (k: string) => [...(sets.get(k) ?? [])],
  del: async () => 1,
};
vi.mock("@/lib/redis", () => ({ getRedis: () => fakeRedis }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
const modelCalls: any[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: async (...a: any[]) => { modelCalls.push(a); return { content: [{ type: "text", text: "[]" }] }; } }; },
}));

import {
  isNearDuplicate, balanceKinds, generateFavourSpecs, recentDescriptions, FALLBACK_FAVOURS, REPLENISH_TARGET_OPEN,
  planReplenish, runReplenish, MODEL_CALLS_PER_DAY, NO_REPEAT_DAYS, type FavourSpec,
} from "@/lib/board-replenish";

const NOW = Date.parse("2026-09-21T20:00:00Z");
const DAY = 86_400_000;
beforeEach(() => { kv.clear(); sets.clear(); modelCalls.length = 0; delete process.env.ANTHROPIC_API_KEY; });

describe("no stale or near-duplicate repeats", () => {
  it("a reworded ask is a near-duplicate; a different ask is not", () => {
    const a = "What is one thing people in your country do that you think the rest of the world should copy?";
    expect(isNearDuplicate("What's one thing people in your country do that the rest of the world should copy?", [a])).toBe(true);
    expect(isNearDuplicate("Show us the most-used object within arm's reach.", [a])).toBe(false);
  });

  it("an ask on the board in the last 14 days, in ANY state, blocks its pool twin", async () => {
    const twin = FALLBACK_FAVOURS[0].description;
    const completedFiveDaysAgo = { status: "completed", description: twin, createdAt: new Date(NOW - 5 * DAY).toISOString(), deadline: new Date(NOW - 4 * DAY).toISOString() } as any;
    const recent = recentDescriptions([completedFiveDaysAgo], NOW);
    expect(recent).toContain(twin);
    const out = await generateFavourSpecs(5, new Set(), { recent });
    expect(out.specs.map((s) => s.description)).not.toContain(twin);
    for (const s of out.specs) expect(isNearDuplicate(s.description, [twin])).toBe(false);
  });

  it("an ask older than 14 days is allowed back", () => {
    const old = { status: "expired", description: "x", createdAt: new Date(NOW - (NO_REPEAT_DAYS + 5) * DAY).toISOString(), deadline: new Date(NOW - (NO_REPEAT_DAYS + 1) * DAY).toISOString() } as any;
    expect(recentDescriptions([old], NOW)).toEqual([]);
  });
});

describe("kinds rotate", () => {
  const spec = (category: string, i: number): FavourSpec => ({ description: `${category} ask number w${i}a w${i}b`, category: category as any, points: 10, deadlineHours: 168, maxCompletions: 50, agentId: "openclaw", location: "Anywhere" });
  it("no kind takes more than half of a run when others exist", () => {
    const specs = [spec("feedback", 1), spec("feedback", 2), spec("feedback", 3), spec("feedback", 4), spec("photo", 5), spec("review", 6)];
    const out = balanceKinds(specs, [], 4);
    expect(out).toHaveLength(4);
    expect(out.filter((s) => s.category === "feedback").length).toBeLessThanOrEqual(2);
  });
  it("the kind thinnest on the board goes first", () => {
    const board = Array.from({ length: 5 }, () => ({ category: "feedback", status: "open" })) as any;
    const out = balanceKinds([spec("feedback", 1), spec("photo", 2)], board, 1);
    expect(out[0].category).toBe("photo");
  });
  it("rotation never leaves the board short", () => {
    const out = balanceKinds([spec("feedback", 1), spec("feedback", 2), spec("feedback", 3)], [], 3);
    expect(out).toHaveLength(3);
  });
});

describe("the target and the model cap", () => {
  it("tops up toward about 15 open favours", () => {
    const plan = planReplenish({ tasks: [], recycledRecently: new Set(), usedToday: 0, now: NOW });
    expect(REPLENISH_TARGET_OPEN).toBe(15);
    expect(plan.deficit).toBe(15);
  });

  it("stops calling the model after the daily cap and uses the pool", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    kv.set(`replenish:model:${new Date(NOW).toISOString().slice(0, 10)}`, MODEL_CALLS_PER_DAY);
    const r = await runReplenish(NOW);
    expect(modelCalls).toHaveLength(0);
    expect(r.generated.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/cap/);
  });

  it("every generated ask is posted by a named agent and is points only", async () => {
    const r = await runReplenish(NOW);
    const ids = new Set(r.generated);
    const stored = [...kv.entries()].filter(([k]) => k.startsWith("task:")).map(([, v]) => JSON.parse(v)).filter((t) => ids.has(t.id));
    expect(stored.length).toBeGreaterThan(0);
    for (const t of stored) {
      expect(t.poster).toMatch(/^agent:/);
      expect(t.agent?.name).toBeTruthy();
      expect(t.rewardType).toBe("points");
      expect(t.onChainId).toBeNull();
      expect(t.escrowTxHash).toBeNull();
    }
  });
});
