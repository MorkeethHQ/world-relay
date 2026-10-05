import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";

// FAULT INJECTION FOR THE RE-CHECK JOB (2026-10-05, finding A of the 01:00 review).
//
// LOCAL DOUBLES ONLY: an in-memory stand-in for Redis that can be told to fail,
// and a verifier supplied by the test. The credit writers (points ledger,
// reputation, completion record, referral, seeded cap) are the REAL ones, so a
// failure inside them behaves as it would in production, including the two
// writers that catch a store error and only log it.
//
// The harness numbers every write command of a clean run, then replays the run
// once per write with a fault at exactly that write, in three ways:
//   throw       that one write fails, the process lives on
//   die-before  the process dies just before that write
//   die-after   that write lands, then the process dies
// After each faulty run a second, clean run is made, as an operator would. A new
// process is simulated with vi.resetModules, and the 2 minute lock is treated as
// expired. The rule under test: whatever the fault, the person ends up credited
// exactly once, and a run never reports points it did not confirm.
const h = vi.hoisted(() => {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, number>>();
  const state = { writes: 0, fault: null as null | { mode: "throw" | "die-before" | "die-after"; n: number }, dead: false, log: [] as string[] };
  const WRITES = new Set(["set", "del", "sadd", "srem", "lpush", "ltrim", "incr", "expire", "hincrby", "zincrby", "eval"]);
  function guard<T>(name: string, key: string, apply: () => T): T {
    if (state.dead) throw new Error("LOCAL DOUBLE: store unreachable (process died)");
    if (WRITES.has(name)) {
      state.writes++;
      state.log.push(`${name} ${key}`);
      const f = state.fault;
      if (f && state.writes === f.n) {
        if (f.mode === "throw") throw new Error(`LOCAL DOUBLE: write ${f.n} failed (${name} ${key})`);
        if (f.mode === "die-before") { state.dead = true; throw new Error("LOCAL DOUBLE: process died before the write"); }
        const r = apply();
        state.dead = true;
        void r;
        throw new Error("LOCAL DOUBLE: process died after the write");
      }
    }
    return apply();
  }
  const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const redis = {
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => guard("set", k, () => { if (o?.nx && kv.has(k)) return null; kv.set(k, str(v)); return "OK"; }),
    get: async (k: string) => guard("get", k, () => kv.get(k) ?? null),
    del: async (k: string) => guard("del", k, () => (kv.delete(k) ? 1 : 0)),
    sadd: async (k: string, m: string) => guard("sadd", k, () => { if (!sets.has(k)) sets.set(k, new Set()); const had = sets.get(k)!.has(m); sets.get(k)!.add(m); return had ? 0 : 1; }),
    srem: async (k: string, m: string) => guard("srem", k, () => (sets.get(k)?.delete(m) ? 1 : 0)),
    smembers: async (k: string) => guard("smembers", k, () => Array.from(sets.get(k) || [])),
    sismember: async (k: string, m: string) => guard("sismember", k, () => (sets.get(k)?.has(m) ? 1 : 0)),
    lpush: async (k: string, v: unknown) => guard("lpush", k, () => { if (!lists.has(k)) lists.set(k, []); lists.get(k)!.unshift(str(v)); return lists.get(k)!.length; }),
    ltrim: async (k: string) => guard("ltrim", k, () => "OK"),
    lrange: async (k: string, a: number, b: number) => guard("lrange", k, () => (lists.get(k) || []).slice(a, b < 0 ? undefined : b + 1)),
    incr: async (k: string) => guard("incr", k, () => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; }),
    expire: async (k: string) => guard("expire", k, () => 1),
    hincrby: async (k: string, f: string, by: number) => guard("hincrby", k, () => { if (!hashes.has(k)) hashes.set(k, new Map()); const m = hashes.get(k)!; m.set(f, (m.get(f) ?? 0) + by); return m.get(f)!; }),
    zincrby: async (k: string) => guard("zincrby", k, () => 1),
    eval: async (_s: string, keys: string[], args: string[]) => guard("eval", keys[0], () => { if (kv.get(keys[0]) === args[0]) { kv.delete(keys[0]); return 1; } return 0; }),
    pipeline: () => { const ops: string[] = []; return { get: (k: string) => { ops.push(k); }, exec: async () => guard("pipeline", "exec", () => ops.map((k) => kv.get(k) ?? null)) }; },
  };
  return { kv, sets, lists, hashes, state, redis };
});
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis }));

const ANA = `0x${"a1".repeat(20)}`;
const NOW = Date.parse("2026-10-05T08:00:00Z");
const THROWN = "AI verification error - proof flagged for manual review. | Verified by orb-level human (1.5x multiplier) (trust score: 62)";
const POINTS = 18;

function seed(o: Partial<Task> = {}): string {
  h.kv.clear(); h.sets.clear(); h.lists.clear(); h.hashes.clear();
  h.state.writes = 0; h.state.fault = null; h.state.dead = false; h.state.log = [];
  const t = {
    id: "t1", poster: "agent:freshmap", claimant: ANA, claimantVerification: "orb", category: "review",
    description: "Which public park or square near you is best, and at what time of day?", location: "Anywhere", lat: null, lng: null,
    bountyUsdc: POINTS, deadline: "2026-10-18T00:00:00.000Z", status: "claimed", proofImageUrl: null, proofImages: null,
    proofNote: "Night market, start from 5pm - 10pm", verificationResult: { verdict: "flag", reasoning: THROWN, confidence: 0 },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 100, completionCount: 0, createdAt: "2026-09-26T08:20:00.000Z", ...o,
  };
  h.sets.set("task_ids", new Set([t.id]));
  h.kv.set(`task:${t.id}`, JSON.stringify(t));
  return t.id;
}

type Outcome = { taskId: string; action: string; detail: string; points?: number };
// One run of the job in a fresh "process". A thrown error stands for a process
// that died: the operator sees a stack trace and no report.
async function run(verdict: "pass" | "fail" = "pass"): Promise<{ out: Outcome[]; crashed: boolean }> {
  vi.resetModules();
  const { recheckThrownProofs } = await import("@/lib/recheck");
  try {
    const out = await recheckThrownProofs({
      apply: true,
      now: () => NOW,
      verify: async () => (verdict === "pass" ? { verdict: "pass", reasoning: "An honest on-topic answer.", confidence: 0.9 } : { verdict: "fail", reasoning: "Unrelated.", confidence: 0.2, tip: "Answer the question." }),
    });
    return { out: out as Outcome[], crashed: false };
  } catch {
    return { out: [], crashed: true };
  }
}
// What an operator does before running again: nothing but wait for the 2 minute
// verify lock (and the 15 second points lock) of the dead process to expire.
function nextProcess() {
  h.state.dead = false; h.state.fault = null;
  for (const k of [...h.kv.keys()]) if (k.startsWith("lock:")) h.kv.delete(k);
}

const json = (k: string) => (h.kv.has(k) ? JSON.parse(h.kv.get(k)!) : null);
function creditState() {
  const task = json("task:t1");
  const pof = json(`pof:${ANA}`);
  const rep = json(`rep:${ANA}`);
  const rows = (h.lists.get(`contributions:${ANA}`) ?? []).map((r) => JSON.parse(r)).filter((r) => r.taskId === "t1");
  return {
    status: task.status, replies: task.completionCount, claimant: task.claimant,
    slot: h.sets.get("completed_claimants:t1")?.has(ANA) ?? false,
    ledgerPoints: pof?.totalPoints ?? 0, ledgerCompleted: pof?.favoursCompleted ?? 0, ledgerAttempted: pof?.favoursAttempted ?? 0,
    repCompleted: rep?.tasksCompleted ?? 0, repPoints: rep?.totalPointsEarned ?? 0,
    historyRows: rows.length, historyPoints: rows[0]?.points ?? 0,
  };
}
const EXACTLY_ONCE = {
  status: "open", replies: 1, claimant: null, slot: true,
  ledgerPoints: POINTS, ledgerCompleted: 1, ledgerAttempted: 1,
  repCompleted: 1, repPoints: POINTS, historyRows: 1, historyPoints: POINTS,
};
const awarded = (out: Outcome[]) => out.filter((o) => o.action === "passed" && (o.points ?? 0) > 0);

beforeEach(() => { seed(); });

describe("a clean run", () => {
  it("credits the person exactly once, and a second run does nothing", async () => {
    const first = await run();
    expect(awarded(first.out)).toHaveLength(1);
    expect(creditState()).toEqual(EXACTLY_ONCE);
    nextProcess();
    const second = await run();
    expect(awarded(second.out)).toHaveLength(0);
    expect(creditState()).toEqual(EXACTLY_ONCE);
  });
});

for (const mode of ["throw", "die-before", "die-after"] as const) {
  describe(`fault at every write of the run in turn: ${mode}`, () => {
    it("a second run always finishes the item exactly once, and no run reports points it did not write", async () => {
      await run();
      const total = h.state.writes;
      const clean = [...h.state.log];
      expect(total).toBeGreaterThan(8);
      const problems: string[] = [];
      for (let n = 1; n <= total; n++) {
        seed();
        h.state.fault = { mode, n };
        const first = await run();
        const at = `${mode} at write ${n} (${clean[n - 1]})`;
        const afterFirst = creditState();
        // A report of awarded points must be true at the moment it is made.
        if (awarded(first.out).length && JSON.stringify(afterFirst) !== JSON.stringify(EXACTLY_ONCE)) {
          problems.push(`${at}: first run reported ${awarded(first.out)[0].points} points awarded, store holds ${JSON.stringify(afterFirst)}`);
        }
        nextProcess();
        const second = await run();
        const afterSecond = creditState();
        if (JSON.stringify(afterSecond) !== JSON.stringify(EXACTLY_ONCE)) {
          problems.push(`${at}: after the second run the store holds ${JSON.stringify(afterSecond)}`);
        }
        // Points are announced as awarded at most once. The one case with no
        // announcement is a process that died after its very last write: it cannot
        // print. The next run must then account for the item by name, as
        // "already-done" with the points in the text.
        const reports = awarded(first.out).length + awarded(second.out).length;
        const accounted = second.out.some((o) => o.action === "already-done" && o.detail.includes(`${POINTS} points written and read back`));
        if (reports > 1) problems.push(`${at}: points were reported as awarded ${reports} times across the two runs`);
        if (reports === 0 && !accounted) problems.push(`${at}: the item was finished and no run accounted for it; first=${JSON.stringify(first)} second=${JSON.stringify(second)}`);
        if (reports === 1 && first.crashed) problems.push(`${at}: a run that crashed cannot have reported`);
        nextProcess();
        const third = await run();
        if (third.out.length || JSON.stringify(creditState()) !== JSON.stringify(EXACTLY_ONCE)) {
          problems.push(`${at}: a third run changed something or reported again`);
        }
      }
      expect(problems).toEqual([]);
    }, 120000);
  });
}

describe("the named steps, one failure each", () => {
  // [what fails, the write command and key it is, which occurrence of that write]
  const STEPS: Array<[string, string, number]> = [
    ["right after the journal is taken (the pending list write)", "sadd recheck:pending", 1],
    ["the verdict on the favour (completeTask)", "set task:t1", 1],
    ["the completer slot", "sadd completed_claimants:t1", 1],
    ["the attempt on the points ledger", `set pof:${ANA}`, 1],
    ["the completion on the reputation", `set rep:${ANA}`, 1],
    ["the points on the points ledger", `set pof:${ANA}`, 2],
    ["the History row", `lpush contributions:${ANA}`, 1],
  ];
  it.each(STEPS)("%s: the first run says failed and reports no points, the second run completes it once", async (_name, write, nth) => {
    await run();
    const hits = h.state.log.map((w, i) => (w === write ? i + 1 : 0)).filter(Boolean);
    expect(hits.length, `"${write}" must be a write of the clean run`).toBeGreaterThanOrEqual(nth);
    seed();
    h.state.fault = { mode: "throw", n: hits[nth - 1] };
    const first = await run();
    expect(first.out).toHaveLength(1);
    expect(first.out[0].action).toBe("failed");
    expect(first.out[0].points).toBeUndefined();
    expect(first.out[0].detail).toContain("The next real run finishes it");
    expect(creditState()).not.toEqual(EXACTLY_ONCE);
    nextProcess();
    const second = await run();
    expect(second.out).toHaveLength(1);
    expect(second.out[0]).toMatchObject({ action: "passed", points: POINTS });
    expect(creditState()).toEqual(EXACTLY_ONCE);
    expect(JSON.parse(h.kv.get(`recheck:job:t1:${ANA}`)!).state).toBe("done");
    expect(h.sets.get("recheck:pending")?.size ?? 0).toBe(0);
  }, 30000);

  it("a dry run after a failed run lists the item as would-resume and writes nothing", async () => {
    await run();
    const n = h.state.log.indexOf(`set rep:${ANA}`) + 1;
    seed();
    h.state.fault = { mode: "throw", n };
    await run();
    nextProcess();
    const before = JSON.stringify([[...h.kv.entries()].sort(), [...h.lists.entries()].sort()]);
    vi.resetModules();
    const { recheckThrownProofs } = await import("@/lib/recheck");
    const out = await recheckThrownProofs({ apply: false, verify: async () => { throw new Error("never called"); } });
    expect(out.map((o) => o.action)).toEqual(["would-resume"]);
    expect(out[0].detail).toContain("reputation");
    expect(JSON.stringify([[...h.kv.entries()].sort(), [...h.lists.entries()].sort()])).toBe(before);
  }, 30000);

  it("a resumed run does not call the model again: the verdict is in the journal", async () => {
    await run();
    const n = h.state.log.indexOf(`lpush contributions:${ANA}`) + 1;
    seed();
    h.state.fault = { mode: "throw", n };
    await run();
    nextProcess();
    vi.resetModules();
    const { recheckThrownProofs } = await import("@/lib/recheck");
    const verify = vi.fn(async () => { throw new Error("the model is down again"); });
    const out = await recheckThrownProofs({ apply: true, verify, now: () => NOW });
    expect(verify).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ action: "passed", points: POINTS });
    expect(creditState()).toEqual(EXACTLY_ONCE);
  }, 30000);
});

describe("a verdict of fail under the same faults", () => {
  it("never credits, never loses the favour, and settles on a second run", async () => {
    await run("fail");
    const total = h.state.writes;
    const problems: string[] = [];
    for (const mode of ["throw", "die-before", "die-after"] as const) {
      for (let n = 1; n <= total; n++) {
        seed();
        h.state.fault = { mode, n };
        await run("fail");
        nextProcess();
        await run("fail");
        const s = creditState();
        if (s.status !== "open" || s.replies !== 0 || s.claimant !== null || s.ledgerPoints !== 0 || s.repPoints !== 0 || s.historyRows !== 0 || s.slot) {
          problems.push(`${mode} at write ${n}: ${JSON.stringify(s)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 120000);
});
