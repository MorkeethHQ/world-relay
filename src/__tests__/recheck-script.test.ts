import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
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
      // The scripts ask a local store whether it is the shipped rehearsal fake
      // (GET /__log). This test double is not that fake, and says so.
      if (req.method === "GET") { res.statusCode = 404; res.end("{}"); return; }
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
  const base: Record<string, string | undefined> = { ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: "t", FAVOUR_CONFIRM_DIR: join(dir, "codes"), ...env };
  if (!("ANTHROPIC_API_KEY" in env)) delete base.ANTHROPIC_API_KEY;
  try {
    const r = await run("node", ["scripts/recheck-thrown-proofs.mjs", ...args], { env: base as NodeJS.ProcessEnv });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}
// A real run the way the operator must do it since 5 Oct: the dry run first, then
// the same command with --apply and the code the dry run printed.
const codeOf = (out: string) => out.match(/--apply --confirm ([0-9a-f]+)/)?.[1];
async function applyRun(args: string[], env: Record<string, string>) {
  const dry = await script(args);
  const code = codeOf(dry.out);
  return script([...args, "--apply", "--confirm", code ?? "none"], env);
}
const WRITES = new Set(["SET", "DEL", "SADD", "SREM", "LPUSH", "LTRIM", "INCR", "HINCRBY", "ZINCRBY", "EVAL", "EXPIRE", "PEXPIRE"]);

describe("scripts/recheck-thrown-proofs.mjs", () => {
  it("with no flag it is a dry run: it lists, and sends no write command to the store", async () => {
    seed(task("t1"), task("t2", { claimant: BEN, proofNote: "Transjakarta" }), task("t3", { verificationResult: { verdict: "flag", reasoning: "Too thin to tell.", confidence: 0.6 } }), task("t4", { campaignId: "first-favour" }));
    const before = dump();
    const r = await script([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Dry run. 2 would be re-checked, 0 would be resumed, 1 skipped. Nothing was written.");
    expect(codeOf(r.out)).toMatch(/^[0-9a-f]{10}$/);
    expect(r.out).toContain("would-recheck t1");
    expect(r.out).not.toContain("t3");
    expect(commands.filter((c) => WRITES.has(c))).toEqual([]);
    expect(dump()).toBe(before);
    expect(unknown).toEqual([]);
  }, 30000);

  it("--apply without a model key stops before it reads or writes anything", async () => {
    seed(task("t1"));
    // A real code from a real dry run, so the run gets past the code check to the key check.
    const code = codeOf((await script([])).out)!;
    const before = dump();
    commands.length = 0;
    const r = await script(["--apply", "--confirm", code]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--apply needs ANTHROPIC_API_KEY");
    expect(commands).toEqual([]);
    expect(dump()).toBe(before);
    // The code was not used up by the refusal: with a key it still starts the run.
    expect((await script(["--apply", "--confirm", code], { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble })).code).toBe(0);
  }, 30000);

  it("an unknown flag is refused, so a typo can never become a real run", async () => {
    seed(task("t1"));
    const r = await script(["--aply"]);
    expect(r.code).toBe(2);
    expect(commands).toEqual([]);
  }, 30000);

  it("the verifier double is refused against a store that is not on this machine", async () => {
    // A code record placed on this machine by hand, so the run gets past the first
    // code check without any request to the remote address.
    mkdirSync(join(dir, "codes"), { recursive: true });
    writeFileSync(join(dir, "codes", "0123456789.json"), JSON.stringify({ host: "example.upstash.io", fingerprint: "x", issuedAt: Date.now() }));
    const r = await script(["--apply", "--confirm", "0123456789"], { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble, KV_REST_API_URL: "https://example.upstash.io" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("refused against a remote store");
    expect(commands).toEqual([]);
  }, 30000);

  it("--apply re-checks, credits through the real writers, writes the History row, and a second run changes nothing", async () => {
    seed(task("t1"), task("t3", { claimant: BEN, verificationResult: { verdict: "flag", reasoning: "Too thin to tell.", confidence: 0.6 } }));
    const realFlagBefore = kv.get("task:t3");
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    const r = await applyRun([], env);
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
    // Run again: the dry run shows an empty list and prints no code, so there is
    // nothing to apply. A real run forced with an old or invented code does not start.
    const again = await script([]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("Dry run. 0 would be re-checked, 0 would be resumed");
    expect(codeOf(again.out)).toBeUndefined();
    expect((await script(["--apply", "--confirm", "0000000000"], env)).code).toBe(2);
    expect(dump()).toBe(after);
    expect(lists.get(`contributions:${ANA}`)).toHaveLength(1);
  }, 60000);

  it("a store error in the middle: the run says FAILED with exit 1 and no points, and the same command again finishes it once", async () => {
    seed(task("t1"));
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    // The reputation write is refused once. That writer catches the error and only
    // logs it, which is the swallowed-error case from the 01:00 review.
    refuseOnce = ["SET", "rep:"];
    const first = await applyRun([], env);
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

    const second = await applyRun([], env);
    expect(second.code).toBe(0);
    expect(second.out).toContain("Applied. passed 1 (18 points read back),");
    expect(JSON.parse(kv.get(`pof:${ANA}`)!)).toMatchObject({ totalPoints: 18, favoursCompleted: 1, favoursAttempted: 1 });
    expect(JSON.parse(kv.get(`rep:${ANA}`)!)).toMatchObject({ tasksCompleted: 1, totalPointsEarned: 18 });
    expect(lists.get(`contributions:${ANA}`)).toHaveLength(1);
    expect(rec("t1")).toMatchObject({ status: "open", completionCount: 1 });
    expect(sets.get("recheck:pending")?.size ?? 0).toBe(0);

    const after = dump();
    const third = await script([]);
    expect(third.code).toBe(0);
    expect(codeOf(third.out)).toBeUndefined();
    expect(dump()).toBe(after);
  }, 90000);

  // Second cold walk: the documented block held the dry run and both --apply lines,
  // so a paste ran the writes. A real run now needs the code its own dry run printed.
  it("--apply with no code, a made-up code, or the code of another list does not start, and sends no write", async () => {
    seed(task("t1"), task("t2", { claimant: BEN, proofNote: "Transjakarta" }));
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    const before = dump();

    const none = await script(["--apply"], env);
    expect(none.code).toBe(2);
    expect(none.out).toContain("Run the dry run");
    expect(commands).toEqual([]);

    const madeUp = await script(["--apply", "--confirm", "0000000000"], env);
    expect(madeUp.code).toBe(2);
    expect(madeUp.out).toContain("NOT STARTED");

    // The code of the one-favour dry run does not start the run of everything.
    const one = codeOf((await script(["--limit", "1"])).out)!;
    const all = await script(["--apply", "--confirm", one], env);
    expect(all.code).toBe(2);

    expect(commands.filter((c) => WRITES.has(c))).toEqual([]);
    expect(dump()).toBe(before);
  }, 60000);

  it("a code goes stale when the list changes after the dry run", async () => {
    seed(task("t1"), task("t2", { claimant: BEN, proofNote: "Transjakarta" }));
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    const code = codeOf((await script([])).out)!;
    // t2 expires between the dry run and the real run.
    kv.set("task:t2", JSON.stringify({ ...rec("t2"), status: "expired" }));
    const before = dump();
    const r = await script(["--apply", "--confirm", code], env);
    expect(r.code).toBe(2);
    expect(r.out).toContain("NOT STARTED");
    // A refusal shows no list and no code: the dry run is the only place for both.
    expect(r.out).not.toContain("would-recheck");
    expect(r.out.replace(code, "")).not.toMatch(/\b[0-9a-f]{10}\b/);
    expect(dump()).toBe(before);
  }, 60000);

  // Third cold read: after a failed one-favour step the doc sent the operator to the
  // whole list. The recovery for a one-favour step is now a one-favour step: an
  // item being resumed counts against --limit, so the same two commands finish it
  // and start nothing new.
  it("after a failed --limit 1 step, the same --limit 1 dry run lists that one favour and nothing else, and its apply finishes it", async () => {
    seed(task("t1"), task("t2", { claimant: BEN, proofNote: "Transjakarta" }));
    const env = { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: passDouble };
    refuseOnce = ["SET", "rep:"];
    const first = await applyRun(["--limit", "1"], env);
    expect(first.code).toBe(1);
    expect(first.out).toContain("FAILED 1");
    expect(first.out).toContain("To finish: run the same dry run again, then the same apply with the new code it prints.");

    const dry = await script(["--limit", "1"]);
    expect(dry.out).toContain("Dry run. 0 would be re-checked, 1 would be resumed");
    expect(dry.out).not.toContain("would-recheck");

    const second = await script(["--limit", "1", "--apply", "--confirm", codeOf(dry.out)!], env);
    expect(second.code).toBe(0);
    expect(second.out).toContain("Applied. passed 1 (18 points read back),");
    // Exactly one of the two favours was done. The other was not started.
    const done = [rec("t1"), rec("t2")].filter((t) => t.status === "open");
    expect(done).toHaveLength(1);
    expect([rec("t1"), rec("t2")].filter((t) => t.status === "claimed")).toHaveLength(1);
  }, 120000);

  it("when the check still throws, nothing changes and the exit code says so", async () => {
    seed(task("t1"));
    const before = dump();
    const r = await applyRun([], { ANTHROPIC_API_KEY: "local-double-not-a-key", RECHECK_VERIFIER_MODULE: throwDouble });
    expect(r.code).toBe(1);
    expect(r.out).toContain("still-failing");
    expect(r.out).toContain("LOCAL DOUBLE: 401 invalid x-api-key");
    expect(dump()).toBe(before);
  }, 30000);
});
