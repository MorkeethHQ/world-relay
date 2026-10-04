import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the REAL operator script against LOCAL DOUBLES (2026-10-05): a fake
// Upstash REST endpoint on 127.0.0.1 that keeps everything in memory, and a
// verifier double loaded from a temp file. No live store, no model, no network
// beyond localhost. The credit writers are the real ones, writing to the fake.
const run = promisify(execFile);
const THROWN = "AI verification error - proof flagged for manual review. | Verified by orb-level human (1.5x multiplier) (trust score: 62)";
const ANA = `0x${"a1".repeat(20)}`;
const BEN = `0x${"b2".repeat(20)}`;

let server: Server;
let url = "";
let kv: Map<string, string>;
let sets: Map<string, Set<string>>;
let lists: Map<string, string[]>;
let hashes: Map<string, Map<string, number>>;
let zsets: Map<string, Map<string, number>>;
let commands: string[];
let unknown: string[];
// One write the fake store refuses, once: [command, key prefix]. Stands for a
// store error in the middle of a run.
let refuseOnce: [string, string] | null;

function exec(args: unknown[]): unknown {
  const [cmdRaw, key, ...rest] = args as [string, string, ...unknown[]];
  const cmd = String(cmdRaw).toUpperCase();
  commands.push(cmd);
  if (refuseOnce && cmd === refuseOnce[0] && String(key).startsWith(refuseOnce[1])) {
    refuseOnce = null;
    throw new Error("LOCAL DOUBLE: store refused this write");
  }
  const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  switch (cmd) {
    case "GET": return kv.get(key) ?? null;
    case "SET": {
      const opts = rest.slice(1).map((x) => String(x).toUpperCase());
      if (opts.includes("NX") && kv.has(key)) return null;
      kv.set(key, str(rest[0]));
      return "OK";
    }
    case "DEL": { const had = kv.delete(key); return had ? 1 : 0; }
    case "EXPIRE": case "PEXPIRE": return 1;
    case "INCR": { const n = Number(kv.get(key) ?? 0) + 1; kv.set(key, String(n)); return n; }
    case "SADD": { if (!sets.has(key)) sets.set(key, new Set()); let n = 0; for (const m of rest) { if (!sets.get(key)!.has(str(m))) n++; sets.get(key)!.add(str(m)); } return n; }
    case "SMEMBERS": return [...(sets.get(key) ?? [])];
    case "SISMEMBER": return sets.get(key)?.has(str(rest[0])) ? 1 : 0;
    case "SREM": { let n = 0; for (const m of rest) if (sets.get(key)?.delete(str(m))) n++; return n; }
    case "LPUSH": { if (!lists.has(key)) lists.set(key, []); for (const v of rest) lists.get(key)!.unshift(str(v)); return lists.get(key)!.length; }
    case "LTRIM": return "OK";
    case "LRANGE": { const l = lists.get(key) ?? []; const b = Number(rest[1]); return l.slice(Number(rest[0]), b < 0 ? undefined : b + 1); }
    case "HINCRBY": { if (!hashes.has(key)) hashes.set(key, new Map()); const h = hashes.get(key)!; const n = (h.get(str(rest[0])) ?? 0) + Number(rest[1]); h.set(str(rest[0]), n); return n; }
    case "ZINCRBY": { if (!zsets.has(key)) zsets.set(key, new Map()); const z = zsets.get(key)!; const n = (z.get(str(rest[1])) ?? 0) + Number(rest[0]); z.set(str(rest[1]), n); return n; }
    case "EVAL": {
      // The one script the credit path runs: release a lock if we still hold it.
      const [, k, token] = rest as [unknown, string, string];
      if (kv.get(k) === token) { kv.delete(k); return 1; }
      return 0;
    }
    default: unknown.push(cmd); return null;
  }
}
const b64 = (v: unknown): unknown =>
  typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : Array.isArray(v) ? v.map(b64) : v;

function task(id: string, o: Record<string, unknown> = {}) {
  return {
    id, poster: "agent:freshmap", claimant: ANA, claimantVerification: "orb", category: "review",
    description: "Which public park or square near you is best, and at what time of day?", location: "Anywhere", lat: null, lng: null,
    bountyUsdc: 18, deadline: "2026-10-18T00:00:00.000Z", status: "claimed", proofImageUrl: null, proofImages: null,
    proofNote: "Night market, start from 5pm - 10pm", verificationResult: { verdict: "flag", reasoning: THROWN, confidence: 0 },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 100, completionCount: 0, createdAt: "2026-09-26T08:20:00.000Z", ...o,
  };
}
function seed(...tasks: Array<ReturnType<typeof task>>) {
  sets.set("task_ids", new Set(tasks.map((t) => t.id)));
  for (const t of tasks) kv.set(`task:${t.id}`, JSON.stringify(t));
}
const rec = (id: string) => JSON.parse(kv.get(`task:${id}`)!);
const dump = () => JSON.stringify([[...kv.entries()].sort(), [...sets.entries()].map(([k, v]) => [k, [...v].sort()]).sort(), [...lists.entries()].sort()]);

beforeEach(async () => {
  kv = new Map(); sets = new Map(); lists = new Map(); hashes = new Map(); zsets = new Map(); commands = []; unknown = []; refuseOnce = null;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const enc = req.headers["upstash-encoding"] === "base64" ? b64 : (v: unknown) => v;
      let answer: unknown;
      try {
        answer = req.url?.includes("pipeline") || req.url?.includes("multi-exec")
          ? (parsed as unknown[][]).map((c) => ({ result: enc(exec(c)) }))
          : { result: enc(exec(parsed)) };
      } catch (err) {
        res.statusCode = 500;
        answer = { error: (err as Error).message };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const dir = mkdtempSync(join(tmpdir(), "recheck-double-"));
const passDouble = join(dir, "pass.mjs");
const throwDouble = join(dir, "throw.mjs");
writeFileSync(passDouble, `export default async () => ({ verdict: "pass", reasoning: "LOCAL DOUBLE: accepted.", confidence: 0.9 });\n`);
writeFileSync(throwDouble, `export default async () => { throw new Error("LOCAL DOUBLE: 401 invalid x-api-key"); };\n`);

async function script(args: string[], env: Record<string, string> = {}) {
  const base: Record<string, string | undefined> = { ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: "t", ...env };
  if (!("ANTHROPIC_API_KEY" in env)) delete base.ANTHROPIC_API_KEY;
  try {
    const r = await run("node", ["scripts/recheck-thrown-proofs.mjs", ...args], { env: base as NodeJS.ProcessEnv });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}
const WRITES = new Set(["SET", "DEL", "SADD", "SREM", "LPUSH", "LTRIM", "INCR", "HINCRBY", "ZINCRBY", "EVAL", "EXPIRE", "PEXPIRE"]);

describe("scripts/recheck-thrown-proofs.mjs", () => {
  it("with no flag it is a dry run: it lists, and sends no write command to the store", async () => {
    seed(task("t1"), task("t2", { claimant: BEN, proofNote: "Transjakarta" }), task("t3", { verificationResult: { verdict: "flag", reasoning: "Too thin to tell.", confidence: 0.6 } }), task("t4", { campaignId: "first-favour" }));
    const before = dump();
    const r = await script([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Dry run. 2 would be re-checked, 0 would be resumed, 1 skipped. Nothing was written.");
    expect(r.out).toContain("would-recheck t1");
    expect(r.out).not.toContain("t3");
    expect(commands.filter((c) => WRITES.has(c))).toEqual([]);
    expect(dump()).toBe(before);
    expect(unknown).toEqual([]);
  }, 30000);

  it("--apply without a model key stops before it reads or writes anything", async () => {
    seed(task("t1"));
    const r = await script(["--apply"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--apply needs ANTHROPIC_API_KEY");
    expect(commands).toEqual([]);
  }, 30000);

  it("an unknown flag is refused, so a typo can never become a real run", async () => {
    seed(task("t1"));
    const r = await script(["--aply"]);
    expect(r.code).toBe(2);
    expect(commands).toEqual([]);
  }, 30000);

  it("the verifier double is refused against a store that is not on this machine", async () => {
    const r = await script(["--apply"], { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble, KV_REST_API_URL: "https://example.upstash.io" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("refused against a remote store");
    expect(commands).toEqual([]);
  }, 30000);

  it("--apply re-checks, credits through the real writers, writes the History row, and a second run changes nothing", async () => {
    seed(task("t1"), task("t3", { claimant: BEN, verificationResult: { verdict: "flag", reasoning: "Too thin to tell.", confidence: 0.6 } }));
    const realFlagBefore = kv.get("task:t3");
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    const r = await script(["--apply"], env);
    expect(r.out).toContain("Applied. passed 1 (18 points read back),");
    expect(r.code).toBe(0);
    expect(unknown).toEqual([]);
    expect(rec("t1")).toMatchObject({ status: "open", completionCount: 1, claimant: null, verificationResult: null });
    expect(sets.get("completed_claimants:t1")?.has(ANA)).toBe(true);
    const history = (lists.get(`contributions:${ANA}`) ?? []).map((x) => JSON.parse(x));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ taskId: "t1", points: 18, proofNote: "Night market, start from 5pm - 10pm" });
    expect(JSON.parse(kv.get(`recheck:job:t1:${ANA}`)!)).toMatchObject({ state: "done", points: 18 });
    expect(JSON.parse(kv.get(`pof:${ANA}`)!)).toMatchObject({ totalPoints: 18, favoursCompleted: 1 });
    expect(JSON.parse(kv.get(`rep:${ANA}`)!)).toMatchObject({ tasksCompleted: 1, totalPointsEarned: 18 });
    expect(lists.get("recheck:log")).toHaveLength(1);
    // The real model flag was not touched, byte for byte.
    expect(kv.get("task:t3")).toBe(realFlagBefore);

    const after = dump();
    const again = await script(["--apply"], env);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Applied. passed 0 (0 points read back),");
    expect(dump()).toBe(after);
    expect(lists.get(`contributions:${ANA}`)).toHaveLength(1);
  }, 60000);

  it("a store error in the middle: the run says FAILED with exit 1 and no points, and the same command again finishes it once", async () => {
    seed(task("t1"));
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    // The reputation write is refused once. That writer catches the error and only
    // logs it, which is the swallowed-error case from the 01:00 review.
    refuseOnce = ["SET", "rep:"];
    const first = await script(["--apply"], env);
    expect(first.code).toBe(1);
    expect(first.out).toContain("failed        t1");
    expect(first.out).toContain("the completion on the reputation was not written");
    expect(first.out).toContain("Applied. passed 0 (0 points read back),");
    expect(first.out).toContain("FAILED 1");
    expect(first.out).toContain("NOT COMPLETE");
    expect(kv.has(`rep:${ANA}`)).toBe(false);
    expect(JSON.parse(kv.get(`recheck:job:t1:${ANA}`)!).state).toBe("in-progress");
    expect(sets.get("recheck:pending")?.size).toBe(1);

    const dry = await script([], {});
    expect(dry.out).toContain("would-resume  t1");
    expect(dry.out).toContain("1 would be resumed");

    const second = await script(["--apply"], env);
    expect(second.code).toBe(0);
    expect(second.out).toContain("Applied. passed 1 (18 points read back),");
    expect(JSON.parse(kv.get(`pof:${ANA}`)!)).toMatchObject({ totalPoints: 18, favoursCompleted: 1, favoursAttempted: 1 });
    expect(JSON.parse(kv.get(`rep:${ANA}`)!)).toMatchObject({ tasksCompleted: 1, totalPointsEarned: 18 });
    expect(lists.get(`contributions:${ANA}`)).toHaveLength(1);
    expect(rec("t1")).toMatchObject({ status: "open", completionCount: 1 });
    expect(sets.get("recheck:pending")?.size ?? 0).toBe(0);

    const after = dump();
    const third = await script(["--apply"], env);
    expect(third.code).toBe(0);
    expect(dump()).toBe(after);
  }, 90000);

  it("when the check still throws, nothing changes and the exit code says so", async () => {
    seed(task("t1"));
    const before = dump();
    const r = await script(["--apply"], { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: throwDouble });
    expect(r.code).toBe(1);
    expect(r.out).toContain("still-failing");
    expect(r.out).toContain("LOCAL DOUBLE: 401 invalid x-api-key");
    expect(dump()).toBe(before);
  }, 30000);
});
