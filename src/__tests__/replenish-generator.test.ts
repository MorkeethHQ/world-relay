import { describe, it, expect, beforeEach, vi } from "vitest";

// THE GENERATOR READS A TOOL CALL, RETRIES ONCE, AND NEVER PASSES THE CAP (2026-09-22).
//
// At 07:03Z on 22 Sep, with the new key, a model reply held no JSON array and the
// run added nothing. That reply was not stored: PR 34, which logs a reply's shape,
// went live after it, and the next run succeeded. So the failing shapes below are
// RECONSTRUCTED, not captured: the ways a text reply has no readable array (prose,
// cut off at max_tokens, empty, a fenced block). If a real one is logged later, add
// it here verbatim.

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

const calls: any[] = [];
const replies: any[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: async (req: any) => { calls.push(req); return replies.shift() ?? { stop_reason: "end_turn", content: [] }; } }; },
}));

import {
  generateFavourSpecs, extractFavourArray, runReplenish, MODEL_CALLS_PER_DAY, FAVOUR_TOOL_NAME,
} from "@/lib/board-replenish";

const NOW = Date.parse("2026-09-22T07:03:00Z");
const ASKS = [
  "What is the one weather sign locals trust more than any app where you live?",
  "Which street food near you is worth crossing town for, and why that one?",
  "Show us the view from where you are sitting right now, exactly as it is.",
  "What song is playing in the nearest shop or cafe to you at this moment?",
  "Which word do people in your town say that nobody else seems to understand?",
  "What would you tell a friend who has never tried a mini app before today?",
];
const fav = (i: number) => ({
  description: ASKS[(i - 1) % ASKS.length],
  category: "feedback", points: 12, deadlineHours: 72, maxCompletions: 20, agentId: "freshmap", location: "Anywhere",
});
const toolReply = (n: number) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: FAVOUR_TOOL_NAME, input: { favours: Array.from({ length: n }, (_, i) => fav(i + 1)) } }] });

// Reconstructed failing shapes (see the header).
const FAILING: Record<string, any> = {
  prose: { stop_reason: "end_turn", content: [{ type: "text", text: "Here are some favours you could post: ask people about their morning, or about the weather." }] },
  truncated: { stop_reason: "max_tokens", content: [{ type: "text", text: `[${JSON.stringify(fav(1))}, {"description": "What is the one` }] },
  empty: { stop_reason: "end_turn", content: [] },
  wrongTool: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "something_else", input: {} }] },
};

beforeEach(() => { kv.clear(); sets.clear(); calls.length = 0; replies.length = 0; process.env.ANTHROPIC_API_KEY = "test"; });

describe("the reply is read from a forced tool call", () => {
  it("asks for the post_favours tool and forces it", async () => {
    replies.push(toolReply(4));
    const out = await generateFavourSpecs(2, new Set());
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_choice).toEqual({ type: "tool", name: FAVOUR_TOOL_NAME });
    expect(calls[0].tools[0].name).toBe(FAVOUR_TOOL_NAME);
    expect(out.generated).toBe(2);
    expect(out.reason).toBeUndefined();
  });
  it("still reads a plain or fenced JSON array in text", () => {
    expect(extractFavourArray({ content: [{ type: "text", text: "```json\n" + JSON.stringify([fav(1)]) + "\n```" }] })).toHaveLength(1);
    expect(extractFavourArray({ content: [{ type: "tool_use", name: FAVOUR_TOOL_NAME, input: [fav(1), fav(2)] }] })).toHaveLength(2);
  });
  it("an empty list is a list, and is not retried", async () => {
    replies.push({ stop_reason: "tool_use", content: [{ type: "tool_use", name: FAVOUR_TOOL_NAME, input: { favours: [] } }] });
    await generateFavourSpecs(2, new Set());
    expect(calls).toHaveLength(1);
  });
  for (const [name, reply] of Object.entries(FAILING)) {
    it(`finds no list in the ${name} reply`, () => {
      expect(extractFavourArray(reply)).toBeNull();
    });
  }
});

describe("one stricter retry, then the pool", () => {
  for (const [name, reply] of Object.entries(FAILING)) {
    it(`the ${name} reply is retried once, and the retry's list is used`, async () => {
      replies.push(reply, toolReply(4));
      const out = await generateFavourSpecs(2, new Set());
      expect(calls).toHaveLength(2);
      expect(calls[1].messages[0].content).toMatch(/could not be read/);
      expect(out.generated).toBe(2);
      expect(out.reason).toMatch(/retried/);
    });
  }
  it("two unreadable replies fall back to the pool, with no third call", async () => {
    replies.push(FAILING.prose, FAILING.truncated);
    const out = await generateFavourSpecs(2, new Set());
    expect(calls).toHaveLength(2);
    expect(out.generated).toBe(0);
    expect(out.specs.length).toBeGreaterThan(0);
    expect(out.reason).toMatch(/no favour list in response \(stop=max_tokens/);
  });
  it("no retry when the cap has no call left", async () => {
    replies.push(FAILING.prose, toolReply(4));
    let left = 1;
    const out = await generateFavourSpecs(2, new Set(), { takeModelCall: async () => left-- > 0 });
    expect(calls).toHaveLength(1);
    expect(out.generated).toBe(0);
    expect(out.reason).toMatch(/no call left to retry/);
  });
});

describe("the daily cap counts every call, the retry included", () => {
  const key = `replenish:model:${new Date(NOW).toISOString().slice(0, 10)}`;
  it("a run with one call left makes one call, even when it fails", async () => {
    kv.set(key, MODEL_CALLS_PER_DAY - 1);
    replies.push(FAILING.empty, toolReply(6));
    await runReplenish(NOW);
    expect(calls).toHaveLength(1);
  });
  it("a failed first reply and its retry count as two calls", async () => {
    replies.push(FAILING.prose, toolReply(6));
    const r = await runReplenish(NOW);
    expect(calls).toHaveLength(2);
    expect(Number(kv.get(key))).toBe(2);
    expect(r.generatedByModel).toBeGreaterThan(0);
  });
});
