import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { realRedis } from "./helpers/real-redis";
import { COMMIT_COMPANY_VOTE } from "@/lib/company-appeal";

// THE FAKE STORE DOES NOT INVENT THE COMPANY REVIEW RULES (2026-10-05).
//
// scripts/fake-store.mjs repeats two inherited Lua scripts in JavaScript so the
// local review fixture can run a company piece through review:
//   - the "open a review once" script inside ensureCompanyAppeal, and
//   - COMMIT_COMPANY_VOTE, the one transaction that saves a company review vote.
// Neither script is changed by this work. This file runs the REAL Lua, read out
// of src/lib/company-appeal.ts, on a real Redis, and the fake with the same
// starting keys and the same arguments, and compares the answer and every key
// each one leaves behind. If the fake drifts from Redis, it goes red.
//
// Opt in, like sol-house-review.real-redis.test.ts, with the disposable
// no-network container running:
//   FAVOUR_REAL_REDIS_TEST=1 npx vitest run --no-file-parallelism src/__tests__/company-review-scripts.real-redis.test.ts
// The two real-Redis files share ONE container and the other one flushes it
// before each test, so they must not run at the same time. Run them one after
// the other, or together with --no-file-parallelism. Run in parallel, this file
// fails for that reason and no other.
const on = process.env.FAVOUR_REAL_REDIS_TEST === "1";
const root = join(__dirname, "..", "..");
const source = readFileSync(join(root, "src", "lib", "company-appeal.ts"), "utf8");
// The init script is not exported, and exporting it would edit inherited code.
const INIT = source.slice(source.indexOf("await redis.eval(`") + "await redis.eval(`".length, source.indexOf("return 1`") + "return 1".length);

type Cmd = [string, ...Array<string | number>];
const sha1 = (v: string) => createHash("sha1").update(v).digest("hex");

let proc: ChildProcess;
let fakeUrl = "";
const real = on ? realRedis() : null;
async function fake(...args: Cmd): Promise<unknown> {
  const r = await fetch(fakeUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.result;
}
const realCmd = (...args: Cmd) => real!.command(args[0], ...args.slice(1));

beforeAll(async () => {
  if (!on) return;
  proc = spawn(process.execPath, [join(root, "scripts", "fake-store.mjs"), "--empty", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  fakeUrl = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("fake store did not start")), 10_000);
    proc.stdout!.on("data", (d: Buffer) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
  });
});
afterAll(() => { proc?.kill(); });

// Every key a scenario may touch, read back the same way from both stores.
const K = {
  verify: "lock:verify:t1", lease: "lock:pof:0xp", task: "task:t1", appeal: "company:appeal:c1", draft: "campaign:draft:d1",
  profile: "pof:0xp", judge: "jury:stats:0xj", done: "completed_claimants:t1", contrib: "contributions:0xp",
  results: "campaign:company:results:d1", evidence: "campaign:company:private-evidence:d1", failed: "failed_claimants:t1",
  index: "pof:__index", weekly: "pof:weekly:2026-10-05", ownerIdx: "company:appeals:0xo", partIdx: "company:appeals:0xp",
};
// Read by the key's own type, so a scenario that plants a key of the wrong type
// can still be compared (a GET on a set is an error on Redis).
async function dump(run: (...a: Cmd) => Promise<unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.values(K)) {
    const type = String(await run("TYPE", k));
    if (type === "none") out[k] = null;
    else if (type === "string") out[k] = { type, value: await run("GET", k) };
    else if (type === "set") out[k] = { type, value: ((await run("SMEMBERS", k)) as string[]).slice().sort() };
    else if (type === "list") out[k] = { type, value: await run("LRANGE", k, 0, -1) };
    else if (type === "hash") {
      // redis-cli prints a hash as an object; the REST shape is a flat list.
      const h = await run("HGETALL", k);
      const pairs = Array.isArray(h) ? h.reduce<string[][]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1].push(String(v)), acc) : [...acc, [String(v)]]), []) : Object.entries(h as Record<string, unknown>).map(([f, v]) => [f, String(v)]);
      out[k] = { type, value: pairs.sort((a, b) => a[0].localeCompare(b[0])) };
    }
    else if (type === "zset") out[k] = { type, value: String(await run("ZSCORE", k, "0xp")) };
    else out[k] = { type };
  }
  return out;
}
// The same scenario on both stores. An error from either is an outcome too.
async function both(setup: Cmd[], script: string, keys: string[], args: Array<string | number>) {
  const answers: Array<{ result: unknown; keys: Record<string, unknown> }> = [];
  for (const run of [realCmd, fake]) {
    for (const k of [...Object.values(K)]) await run("DEL", k);
    for (const c of setup) await run(...c);
    let result: unknown;
    try {
      result = await run("EVAL", script, keys.length, ...keys, ...args);
      if (typeof result === "string" && /type mismatch/i.test(result)) result = "ERROR";
    } catch { result = "ERROR"; }
    answers.push({ result, keys: await dump(run) });
  }
  return { real: answers[0], fake: answers[1] };
}

const TASK = JSON.stringify({ id: "t1", status: "claimed" });
const APPEAL = JSON.stringify({ id: "c1", outcome: "pending", votes: [] });
const DRAFT = JSON.stringify({ id: "d1", status: "published" });
const PROFILE = JSON.stringify({ address: "0xp", totalPoints: 40 });
const base: Cmd[] = [
  ["SET", K.verify, "tok"], ["SET", K.lease, "lease"], ["SET", K.task, TASK], ["SET", K.appeal, APPEAL],
  ["SET", K.draft, DRAFT], ["SET", K.profile, PROFILE], ["HSET", K.judge, "judged", "12", "correct", "10"],
];
const commitKeys = [K.verify, K.lease, K.task, K.appeal, K.draft, K.profile, K.judge, K.done, K.contrib, K.results, K.evidence, K.failed, K.index, K.weekly];
// ARGV in the order recordCompanyAppealVote passes them.
const commitArgs = (outcome: "pending" | "cleared" | "upheld", over: Partial<Record<number, string | number>> = {}) => {
  const a: Array<string | number> = [
    "tok", "lease", sha1(TASK), sha1(APPEAL), sha1(DRAFT), sha1(PROFILE), outcome, "0xp",
    JSON.stringify({ id: "c1", outcome, votes: [1] }), JSON.stringify({ id: "t1", status: outcome === "cleared" ? "open" : "claimed", next: true }),
    JSON.stringify({ verdict: outcome }), JSON.stringify({ evidence: true }), JSON.stringify({ contribution: true }),
    JSON.stringify({ address: "0xp", totalPoints: 47 }), 7, 50, 10, 0.6,
  ];
  for (const [i, v] of Object.entries(over)) a[Number(i)] = v as string | number;
  return a;
};

describe.skipIf(!on)("the fake store runs the company review scripts as Redis does", () => {
  it("found both inherited scripts in the source, unedited", () => {
    expect(INIT).toContain("Review store type mismatch");
    expect(INIT).toContain("redis.call('SET',KEYS[1],ARGV[1],'NX')");
    expect(COMMIT_COMPANY_VOTE).toContain("lock_expired");
    expect(COMMIT_COMPANY_VOTE).toContain("already_completed");
  });

  const initKeys = [K.appeal, K.ownerIdx, K.partIdx];
  it.each<[string, Cmd[]]>([
    ["a first review is opened and indexed for the owner and the participant", []],
    ["a second call does not replace the first review or add to the indexes", [["SET", K.appeal, "first"]]],
    ["an index that is not a set is an error and nothing is written", [["SET", K.ownerIdx, "not-a-set"]]],
    ["a case key that is not a string is an error", [["SADD", K.appeal, "x"]]],
  ])("open a review: %s", async (_n, setup) => {
    const r = await both(setup, INIT, initKeys, [JSON.stringify({ id: "c1" }), "c1"]);
    expect(r.fake).toEqual(r.real);
  });

  it.each<[string, Cmd[], Array<string | number>, string]>([
    ["a first vote that leaves the case pending saves the case only", base, commitArgs("pending"), "ok"],
    ["the vote that clears it writes task, results, evidence, completer, History, profile, index and weekly points", base, commitArgs("cleared"), "ok"],
    ["the vote that declines it writes task, results, evidence and the failed set, and no credit", base, commitArgs("upheld"), "ok"],
    ["a lost verify lock stops it", base, commitArgs("cleared", { 0: "someone-else" }), "lock_expired"],
    ["a lost wallet lock stops it", base, commitArgs("cleared", { 1: "someone-else" }), "lock_expired"],
    ["a task that changed since it was read stops it", base, commitArgs("cleared", { 2: sha1("other") }), "changed"],
    ["a case that changed stops it", base, commitArgs("cleared", { 3: sha1("other") }), "changed"],
    ["a campaign that changed stops it", base, commitArgs("cleared", { 4: sha1("other") }), "changed"],
    ["a points profile that changed stops it", base, commitArgs("cleared", { 5: sha1("other") }), "changed"],
    ["a profile that does not exist yet is read as the empty hash", base.filter((c) => c[1] !== K.profile), commitArgs("cleared", { 5: "" }), "ok"],
    ["a judge with too few graded cards is refused", [...base.filter((c) => c[1] !== K.judge), ["HSET", K.judge, "judged", "9", "correct", "9"]], commitArgs("cleared"), "unqualified"],
    ["a judge under the accuracy bar is refused", [...base.filter((c) => c[1] !== K.judge), ["HSET", K.judge, "judged", "20", "correct", "11"]], commitArgs("cleared"), "unqualified"],
    ["a judge with no record is refused", base.filter((c) => c[1] !== K.judge), commitArgs("cleared"), "unqualified"],
    ["a person who already completed the piece is not cleared twice", [...base, ["SADD", K.done, "0xp"]], commitArgs("cleared"), "already_completed"],
    ["that same person can still be declined", [...base, ["SADD", K.done, "0xp"]], commitArgs("upheld"), "ok"],
    ["a key of the wrong type stops it before anything is written", [...base, ["SET", K.done, "not-a-set"]], commitArgs("cleared"), "storage_type"],
    ["History is kept to the cap passed in", [...base, ["RPUSH", K.contrib, "a", "b", "c"]], commitArgs("cleared", { 15: 2 }), "ok"],
  ])("save a vote: %s", async (_n, setup, args, expected) => {
    const r = await both(setup, COMMIT_COMPANY_VOTE, commitKeys, args);
    // First what Redis itself says, so the expectation is about Redis, not the fake.
    expect(r.real.result).toBe(expected);
    expect(r.fake).toEqual(r.real);
  });

  it("the comparison can fail: a refused vote leaves the task untouched on Redis, and a saved one does not", async () => {
    const refused = await both(base, COMMIT_COMPANY_VOTE, commitKeys, commitArgs("cleared", { 0: "someone-else" }));
    expect(refused.real.keys[K.task]).toEqual({ type: "string", value: TASK });
    expect(refused.real.keys[K.done]).toBeNull();
    const saved = await both(base, COMMIT_COMPANY_VOTE, commitKeys, commitArgs("cleared"));
    expect(saved.real.keys[K.task]).not.toEqual({ type: "string", value: TASK });
    expect(saved.real.keys[K.done]).toEqual({ type: "set", value: ["0xp"] });
    expect(saved.real.keys[K.weekly]).toEqual({ type: "zset", value: "7" });
    expect(saved.real.keys[K.profile]).toEqual({ type: "string", value: JSON.stringify({ address: "0xp", totalPoints: 47 }) });
    expect(saved.fake).toEqual(saved.real);
  });
});
