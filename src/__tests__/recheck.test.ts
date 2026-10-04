import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Task } from "@/lib/types";

// LOCAL DOUBLES ONLY (2026-10-05). The store is an in-memory stand-in for Redis,
// the verifier is a function this test supplies, and the people are made-up wallet
// addresses. Nothing here reaches the live app or a model. The credit writers
// (points ledger, reputation, completion record) are the REAL ones, writing to the
// in-memory store, because the job confirms every credit by reading it back.
const kv = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const lists = new Map<string, string[]>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, typeof v === "string" ? v : JSON.stringify(v)); return "OK"; },
    get: async (k: string) => kv.get(k) ?? null,
    del: async (k: string) => { kv.delete(k); return 1; },
    sadd: async (k: string, m: string) => { if (!sets.has(k)) sets.set(k, new Set()); const had = sets.get(k)!.has(m); sets.get(k)!.add(m); return had ? 0 : 1; },
    srem: async (k: string, m: string) => (sets.get(k)?.delete(m) ? 1 : 0),
    smembers: async (k: string) => Array.from(sets.get(k) || []),
    sismember: async (k: string, m: string) => (sets.get(k)?.has(m) ? 1 : 0),
    lpush: async (k: string, v: string) => { if (!lists.has(k)) lists.set(k, []); lists.get(k)!.unshift(v); return lists.get(k)!.length; },
    ltrim: async () => "OK",
    lrange: async (k: string, a: number, b: number) => (lists.get(k) || []).slice(a, b < 0 ? undefined : b + 1),
    incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; },
    expire: async () => 1,
    hincrby: async () => 1,
    zincrby: async () => 1,
    eval: async (_s: string, keys: string[], args: string[]) => { if (kv.get(keys[0]) === args[0]) { kv.delete(keys[0]); return 1; } return 0; },
    pipeline: () => { const ops: Array<() => unknown> = []; return { get: (k: string) => { ops.push(() => kv.get(k) ?? null); }, exec: async () => ops.map((op) => op()) }; },
  }),
}));

import { createTask, claimTask, submitProof, completeTask, getTask } from "@/lib/store";
import { listContributions, checkCompletedTask } from "@/lib/completions";
import { forgetReputation } from "@/lib/reputation";
import { recheckThrownProofs, isThrownCheck, recheckSkipReason, recheckJobKey, THROWN_CHECK_TEXT, RECHECK_LOG_KEY, RECHECK_PENDING_KEY, type Verifier } from "@/lib/recheck";

const ANA = `0x${"a1".repeat(20)}`;
const BEN = `0x${"b2".repeat(20)}`;
const THROWN = { verdict: "flag" as const, reasoning: `${THROWN_CHECK_TEXT} | Verified by orb-level human (1.5x multiplier) (trust score: 62)`, confidence: 0 };
const NOW = Date.parse("2026-10-05T08:00:00Z");

async function favour(o: Record<string, unknown> = {}, who = ANA, note = "Night market, start from 5pm - 10pm", verdict: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number } = THROWN): Promise<string> {
  const t = await createTask({ poster: "agent:freshmap", agentId: "freshmap", description: "Which public park or square near you is best, and at what time of day?", location: "Anywhere", bountyUsdc: 18, deadlineHours: 336, rewardType: "points", maxCompletions: 100, category: "review", ...o } as Parameters<typeof createTask>[0]);
  await claimTask(t.id, who, "orb");
  await submitProof(t.id, null, note, null, who, "orb");
  await completeTask(t.id, verdict);
  return t.id;
}
const snapshot = () => JSON.stringify([[...kv.entries()].filter(([k]) => !k.startsWith("lock:")).sort(), [...sets.entries()].map(([k, v]) => [k, [...v].sort()]).sort(), [...lists.entries()].sort()]);
const pass: Verifier = async () => ({ verdict: "pass", reasoning: "An honest on-topic answer.", confidence: 0.9 });
const stored = (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null);
// What the store holds for a person, read directly: the points ledger and the reputation.
const ledger = (who: string) => stored(`pof:${who}`) ?? { totalPoints: 0, favoursCompleted: 0, favoursFailed: 0 };
const reputation = (who: string) => stored(`rep:${who}`) ?? { tasksCompleted: 0, totalPointsEarned: 0, tasksFailed: 0 };

beforeEach(() => { kv.clear(); sets.clear(); lists.clear(); forgetReputation(ANA); forgetReputation(BEN); });

describe("which favours the re-check picks", () => {
  it("picks the thrown-check fallback and nothing else", async () => {
    const thrown = await getTask(await favour());
    const realFlag = await getTask(await favour({}, BEN, "yes", { verdict: "flag", reasoning: "The answer does not address the question.", confidence: 0.5 }));
    expect(isThrownCheck(thrown!)).toBe(true);
    expect(isThrownCheck(realFlag!)).toBe(false);
    const variants: Array<Partial<Task>> = [
      { status: "open" }, { status: "completed" }, { status: "expired" },
      { verificationResult: { ...THROWN, confidence: 0.01 } },
      { verificationResult: { ...THROWN, verdict: "fail" } },
      { verificationResult: { verdict: "flag", confidence: 0, reasoning: "AI verification unavailable - proof requires manual review." } },
      { verificationResult: { verdict: "flag", confidence: 0, reasoning: "Could not parse AI response" } },
      { verificationResult: null },
    ];
    for (const v of variants) expect(isThrownCheck({ ...thrown!, ...v } as Task), JSON.stringify(v)).toBe(false);
  });

  it("the text it matches is the text the route writes", () => {
    const route = readFileSync("src/app/api/verify-proof/route.ts", "utf8");
    expect(route).toContain(`reasoning: "${THROWN_CHECK_TEXT}", confidence: 0`);
  });

  it("leaves money, campaign, recurring, webhook and hidden favours alone, with a reason", async () => {
    const t = (await getTask(await favour()))!;
    expect(recheckSkipReason(t)).toBeNull();
    expect(recheckSkipReason({ ...t, rewardType: "usdc-v2" } as Task)).toMatch(/money/);
    expect(recheckSkipReason({ ...t, onChainId: 7 } as Task)).toMatch(/money/);
    expect(recheckSkipReason({ ...t, escrowTxHash: "0xabc" } as Task)).toMatch(/money/);
    expect(recheckSkipReason({ ...t, taskType: "double-or-nothing" } as Task)).toMatch(/double/);
    expect(recheckSkipReason({ ...t, campaignId: "first-favour" } as Task)).toMatch(/campaign/);
    expect(recheckSkipReason({ ...t, companyCampaignId: "draft_x" } as Task)).toMatch(/company/);
    expect(recheckSkipReason({ ...t, callbackUrl: "https://example.org/hook" } as Task)).toMatch(/webhook/);
    expect(recheckSkipReason({ ...t, hiddenAt: "2026-10-01T00:00:00Z" } as Task)).toMatch(/hidden/);
    expect(recheckSkipReason({ ...t, proofNote: " ", proofImageUrl: null, proofImages: null } as Task)).toMatch(/no stored proof/);
    expect(recheckSkipReason({ ...t, claimant: "dev_someone" } as Task)).toMatch(/not a wallet/);
  });
});

describe("dry run, the default", () => {
  it("lists what it would re-check and writes nothing at all", async () => {
    await favour();
    await favour({ description: "Rate the public transport where you live out of 10, with one reason." }, BEN, "Transjakarta");
    await favour({ campaignId: "first-favour" }, BEN, "campaign answer");
    const before = snapshot();
    const verify = vi.fn(pass);
    const out = await recheckThrownProofs({ apply: false, verify });
    expect(out.map((o) => o.action).sort()).toEqual(["skipped", "would-recheck", "would-recheck"]);
    expect(verify).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
    expect([...kv.keys()].some((k) => k.startsWith("recheck:") || k.startsWith("lock:"))).toBe(false);
    expect(ledger(ANA).totalPoints + ledger(BEN).totalPoints).toBe(0);
  });
});

describe("a real run", () => {
  it("a pass counts the reply, reopens the favour, credits once and writes the History row", async () => {
    const id = await favour();
    const verify = vi.fn(pass);
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(verify).toHaveBeenCalledWith("Which public park or square near you is best, and at what time of day?", [], "Night market, start from 5pm - 10pm", "review", "freshmap");
    expect(o.action).toBe("passed");
    expect(o.points).toBe(18);
    const t = (await getTask(id))!;
    expect(t.status).toBe("open");
    expect(t.completionCount).toBe(1);
    expect(t.claimant).toBeNull();
    expect(await checkCompletedTask(id, ANA)).toBe("yes");
    expect(ledger(ANA)).toMatchObject({ totalPoints: 18, favoursCompleted: 1 });
    expect(reputation(ANA)).toMatchObject({ tasksCompleted: 1, totalPointsEarned: 18, verificationLevel: "orb" });
    const history = await listContributions(ANA);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ taskId: id, points: 18, proofNote: "Night market, start from 5pm - 10pm", at: "2026-10-05T08:00:00.000Z" });
    expect(lists.get(RECHECK_LOG_KEY)).toHaveLength(1);
    expect(stored(recheckJobKey(id, ANA))).toMatchObject({ state: "done", points: 18 });
    expect(sets.get(RECHECK_PENDING_KEY)?.size ?? 0).toBe(0);
    expect(kv.has(`lock:verify:${id}`)).toBe(false);
  });

  it("is idempotent: a second run checks nothing, credits nothing, adds no History row", async () => {
    await favour();
    const verify = vi.fn(pass);
    await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    const after = snapshot();
    const second = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(second).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(ledger(ANA).totalPoints).toBe(18);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect(snapshot()).toBe(after);
  });

  it("two runs at once work from one journal: the favour is credited once", async () => {
    const id = await favour();
    // The double stands in for a second run that got its journal in first, with a
    // DIFFERENT verdict, while this run was still waiting for the model.
    const verify = vi.fn(async () => {
      const t = (await getTask(id))!;
      kv.set(recheckJobKey(id, ANA), JSON.stringify({ state: "in-progress", taskId: id, claimant: ANA, startedAt: "2026-10-05T07:59:00.000Z", updatedAt: "2026-10-05T07:59:00.000Z", verdict: { verdict: "fail", confidence: 0.2, reasoning: "Unrelated." }, task: { ...t, proofImages: undefined, verificationResult: undefined }, streak: 0, completion: 18, points: 18, slotFreeBefore: true, once: {} }));
      return { verdict: "pass" as const, reasoning: "ok", confidence: 0.9 };
    });
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    // The journal that was there first decides. This run's own verdict is dropped.
    expect(o.action).toBe("rejected");
    expect(ledger(ANA).totalPoints).toBe(0);
    expect(await listContributions(ANA)).toHaveLength(0);
    expect((await getTask(id))!.status).toBe("open");
  });

  it("never touches a favour whose flag is a real model verdict", async () => {
    const id = await favour({}, BEN, "yes", { verdict: "flag", reasoning: "The answer does not address the question.", confidence: 0.5 });
    const before = snapshot();
    const verify = vi.fn(pass);
    const out = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(out).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
    expect((await getTask(id))!.verificationResult!.confidence).toBe(0.5);
  });

  it("never touches another kind of empty flag either (the parse fallback, confidence 0)", async () => {
    await favour({}, BEN, "hmm", { verdict: "flag", reasoning: "Could not parse AI response, flagged for manual review", confidence: 0 });
    const before = snapshot();
    const verify = vi.fn(pass);
    expect(await recheckThrownProofs({ apply: true, verify, now: () => NOW })).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it("when the check throws again the favour is left exactly as it was and can be retried", async () => {
    const id = await favour();
    const before = snapshot();
    const [o] = await recheckThrownProofs({ apply: true, verify: async () => { throw new Error("401 invalid x-api-key"); }, now: () => NOW });
    expect(o.action).toBe("still-failing");
    expect(o.detail).toContain("401 invalid x-api-key");
    expect(snapshot()).toBe(before);
    expect(kv.has(`lock:verify:${id}`)).toBe(false);
    const [again] = await recheckThrownProofs({ apply: true, verify: pass, now: () => NOW });
    expect(again.action).toBe("passed");
  });

  it("an answer with no judgement (flag at confidence 0) is not stored", async () => {
    await favour();
    const before = snapshot();
    const [o] = await recheckThrownProofs({ apply: true, verify: async () => ({ verdict: "flag", reasoning: "Could not parse AI response", confidence: 0 }), now: () => NOW });
    expect(o.action).toBe("still-failing");
    expect(snapshot()).toBe(before);
  });

  it("a fail reopens the favour, records the failure, and writes no credit and no History row", async () => {
    const id = await favour({}, BEN, "Earn money");
    const [o] = await recheckThrownProofs({ apply: true, verify: async () => ({ verdict: "fail", reasoning: "Unrelated to the question.", confidence: 0.2, tip: "Answer the question that was asked." }), now: () => NOW });
    expect(o.action).toBe("rejected");
    expect(o.points).toBeUndefined();
    const t = (await getTask(id))!;
    expect(t.status).toBe("open");
    expect(t.completionCount).toBe(0);
    expect(sets.get(`failed_claimants:${id}`)?.has(BEN)).toBe(true);
    expect(reputation(BEN)).toMatchObject({ tasksFailed: 1, tasksCompleted: 0, totalPointsEarned: 0 });
    expect(ledger(BEN).totalPoints).toBe(0);
    expect(await listContributions(BEN)).toHaveLength(0);
    expect(await checkCompletedTask(id, BEN)).toBe("no");
    expect(stored(recheckJobKey(id, BEN)).state).toBe("done");
  });

  it("a real flag from the re-check replaces the empty one, credits nothing, and is not picked again", async () => {
    const id = await favour();
    const verify = vi.fn(async () => ({ verdict: "flag" as const, reasoning: "Plausible but too thin to tell.", confidence: 0.7 }));
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(o.action).toBe("flagged");
    const t = (await getTask(id))!;
    expect(t.status).toBe("claimed");
    expect(t.claimant).toBe(ANA);
    expect(t.verificationResult).toMatchObject({ verdict: "flag", confidence: 0.7 });
    expect(t.verificationResult!.reasoning).toContain("Re-checked 2026-10-05");
    expect(ledger(ANA).totalPoints).toBe(0);
    expect(await recheckThrownProofs({ apply: true, verify, now: () => NOW })).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("a person who already holds the completion slot passes with no credit", async () => {
    const id = await favour();
    sets.set(`completed_claimants:${id}`, new Set([ANA]));
    const [o] = await recheckThrownProofs({ apply: true, verify: pass, now: () => NOW });
    expect(o.action).toBe("passed");
    expect(o.points).toBeUndefined();
    expect(o.detail).toContain("no credit written");
    expect(ledger(ANA).totalPoints).toBe(0);
    expect(await listContributions(ANA)).toHaveLength(0);
  });

  it("skips a money or campaign favour even on a real run, untouched", async () => {
    const id = await favour({ campaignId: "first-favour" });
    const before = snapshot();
    const verify = vi.fn(pass);
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(o.action).toBe("skipped");
    expect(verify).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
    expect((await getTask(id))!.status).toBe("claimed");
  });

  it("backs off when a live verification holds the lock", async () => {
    const id = await favour();
    kv.set(`lock:verify:${id}`, "1");
    const before = snapshot();
    const verify = vi.fn(pass);
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(o.action).toBe("busy");
    expect(verify).not.toHaveBeenCalled();
    expect(kv.get(`lock:verify:${id}`)).toBe("1");
    expect(snapshot()).toBe(before);
  });

  it("a photo proof is read from the store and handed to the check as base64", async () => {
    const t = await createTask({ poster: "agent:dropscout", description: "Show us the sky from where you are right now, exactly as it looks.", location: "Anywhere", bountyUsdc: 15, deadlineHours: 336, rewardType: "points", maxCompletions: 100, category: "photo" } as Parameters<typeof createTask>[0]);
    await submitProof(t.id, "data:image/jpeg;base64,/9j/AAAA", "", ["data:image/jpeg;base64,/9j/AAAA", "https://blob.example/p/1.jpg"], ANA, "orb");
    await completeTask(t.id, THROWN);
    const verify = vi.fn(pass);
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const [o] = await recheckThrownProofs({ apply: true, verify, now: () => NOW, fetchImpl });
    expect(o.action).toBe("passed");
    expect(verify.mock.calls[0][1]).toEqual(["/9j/AAAA", "AQID"]);
    expect(fetchImpl).toHaveBeenCalledWith("https://blob.example/p/1.jpg");
    // The journal keeps no inline image bytes.
    expect(kv.get(recheckJobKey(t.id, ANA))).not.toContain("/9j/AAAA");
  });

  it("--only and --limit narrow a run", async () => {
    const a = await favour();
    await favour({ description: "Rate the public transport where you live out of 10, with one reason." }, BEN, "Transjakarta");
    expect(await recheckThrownProofs({ apply: false, verify: pass, only: a })).toHaveLength(1);
    expect(await recheckThrownProofs({ apply: false, verify: pass, limit: 1 })).toHaveLength(1);
  });
});
