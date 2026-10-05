import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { verifySessionToken } from "@/lib/session";

// THE LOCAL REVIEW FIXTURE (2026-10-05). The fake store is started for real on a
// free port and spoken to over HTTP, the way the app's store client does.
const root = join(__dirname, "..", "..");
const fx = JSON.parse(readFileSync(join(root, "scripts", "review-fixture.json"), "utf8"));
let proc: ChildProcess;
let base = "";

beforeAll(async () => {
  proc = spawn(process.execPath, [join(root, "scripts", "fake-store.mjs"), "--empty", "--fixture", join(root, "scripts", "review-fixture.json"), "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("fake store did not start")), 10_000);
    proc.stdout!.on("data", (d: Buffer) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
    proc.on("exit", (c) => reject(new Error(`fake store exited ${c}`)));
  });
});
afterAll(() => { proc?.kill(); });

const cmd = async (...args: unknown[]) => {
  const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return { status: r.status, ...(await r.json()) } as { status: number; result?: unknown; error?: string };
};

describe("the fake store answers what the app sends", () => {
  it("hashes, with HGETALL as the flat list the REST client expects", async () => {
    expect((await cmd("HSET", "h", "a", "1", "b", "x")).result).toBe(2);
    expect((await cmd("HGETALL", "h")).result).toEqual(["a", "1", "b", "x"]);
    expect((await cmd("HINCRBY", "h", "a", 2)).result).toBe(3);
    expect((await cmd("HGET", "h", "a")).result).toBe("3");
    expect((await cmd("HSETNX", "h", "a", "9")).result).toBe(0);
    expect((await cmd("HDEL", "h", "b")).result).toBe(1);
    expect((await cmd("HGETALL", "missing")).result).toEqual([]);
  });
  it("counts, existence, lists and multi-key delete", async () => {
    await cmd("SADD", "s", "x", "y");
    expect((await cmd("SCARD", "s")).result).toBe(2);
    expect((await cmd("EXISTS", "s")).result).toBe(1);
    expect((await cmd("EXISTS", "nope")).result).toBe(0);
    await cmd("RPUSH", "l", "1", "2", "3");
    await cmd("LTRIM", "l", 0, 1);
    expect((await cmd("LRANGE", "l", 0, -1)).result).toEqual(["1", "2"]);
    await cmd("SET", "k1", "v"); await cmd("SET", "k2", "v");
    expect((await cmd("DEL", "k1", "k2", "s")).result).toBe(3);
    expect((await cmd("INCRBY", "n", 5)).result).toBe(5);
    expect((await cmd("DECR", "n")).result).toBe(4);
    expect((await cmd("KEYS", "k*")).result).toEqual([]);
  });
  it("the read-with-hash script returns the value and its SHA-1, or two empty strings", async () => {
    const script = "local v = redis.call('GET', KEYS[1]); return {v or '', v and redis.sha1hex(v) or ''}";
    await cmd("SET", "snap", "hello");
    expect((await cmd("EVAL", script, 1, "snap")).result).toEqual(["hello", "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"]);
    expect((await cmd("EVAL", script, 1, "absent")).result).toEqual(["", ""]);
  });
  it("the three review scripts behave as they do on Redis: slot with its marker, History once, keyed credit by compare-and-set", async () => {
    const { CLAIM_SLOT_FOR_CASE, RECORD_HISTORY_ONCE } = await import("@/lib/house-review");
    const { COMMIT_KEYED_CREDIT } = await import("@/lib/proof-of-favour");
    // Slot: the first call takes it, a repeat for the same case reads its own
    // marker, and another case for the same person is told it is taken.
    expect((await cmd("EVAL", CLAIM_SLOT_FOR_CASE, 2, "completed_claimants:fx", "house:review:slot:caseA", "0xabc", 60)).result).toBe("credit");
    expect((await cmd("EVAL", CLAIM_SLOT_FOR_CASE, 2, "completed_claimants:fx", "house:review:slot:caseA", "0xabc", 60)).result).toBe("credit");
    expect((await cmd("EVAL", CLAIM_SLOT_FOR_CASE, 2, "completed_claimants:fx", "house:review:slot:caseB", "0xabc", 60)).result).toBe("none");
    expect((await cmd("SCARD", "completed_claimants:fx")).result).toBe(1);
    // History: one row, however often it runs.
    expect((await cmd("EVAL", RECORD_HISTORY_ONCE, 2, "house:review:history:caseA", "contributions:0xabc", "at", "{\"row\":1}", 50, 60)).result).toBe(1);
    expect((await cmd("EVAL", RECORD_HISTORY_ONCE, 2, "house:review:history:caseA", "contributions:0xabc", "at", "{\"row\":1}", 50, 60)).result).toBe(0);
    expect((await cmd("LLEN", "contributions:0xabc")).result).toBe(1);
    // Credit: needs the lock token and the exact bytes that were read.
    await cmd("SET", "pof:0xabc", "old");
    await cmd("SET", "lock:pof:0xabc", "tok");
    const sha = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"; // not the hash of "old"
    expect((await cmd("EVAL", COMMIT_KEYED_CREDIT, 4, "pof:0xabc", "pof:__index", "pof:weekly:x", "lock:pof:0xabc", sha, "new", "0xabc", 5, "tok")).result).toBe("changed");
    expect((await cmd("EVAL", COMMIT_KEYED_CREDIT, 4, "pof:0xabc", "pof:__index", "pof:weekly:x", "lock:pof:0xabc", "067017b5bc1fa7b1d1a0b0ea1d6c9ae9cb80a2a0", "new", "0xabc", 5, "wrong")).result).toBe("lock");
    const { createHash } = await import("crypto");
    const real = createHash("sha1").update("old").digest("hex");
    expect((await cmd("EVAL", COMMIT_KEYED_CREDIT, 4, "pof:0xabc", "pof:__index", "pof:weekly:x", "lock:pof:0xabc", real, "new", "0xabc", 5, "tok")).result).toBe("ok");
    expect((await cmd("GET", "pof:0xabc")).result).toBe("new");
  });

  it("SCAN, TYPE and the capital-letter lock release, which the company review path sends", async () => {
    await cmd("SET", "verified:0xa", "1"); await cmd("SET", "verified:0xb", "1"); await cmd("SADD", "other:set", "x");
    const scan = (await cmd("SCAN", 0, "MATCH", "verified:*", "COUNT", 200)).result as [string, string[]];
    expect(scan[0]).toBe("0");
    expect(scan[1].sort()).toEqual(["verified:0xa", "verified:0xb"]);
    expect((await cmd("TYPE", "verified:0xa")).result).toBe("string");
    expect((await cmd("TYPE", "other:set")).result).toBe("set");
    expect((await cmd("TYPE", "nothing")).result).toBe("none");
    const release = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0";
    await cmd("SET", "lock:verify:x", "mine");
    expect((await cmd("EVAL", release, 1, "lock:verify:x", "not-mine")).result).toBe(0);
    expect((await cmd("EVAL", release, 1, "lock:verify:x", "mine")).result).toBe(1);
    expect((await cmd("GET", "lock:verify:x")).result).toBeNull();
  });

  it("answers the company review scripts in the ordinary suite too (their rules are pinned against real Redis elsewhere)", async () => {
    const { COMMIT_COMPANY_VOTE } = await import("@/lib/company-appeal");
    const keys = ["lock:verify:t", "lock:pof:p", "task:t", "company:appeal:c", "campaign:draft:d", "pof:p", "jury:stats:j", "completed_claimants:t", "contributions:p", "campaign:company:results:d", "campaign:company:private-evidence:d", "failed_claimants:t", "pof:__index2", "pof:weekly:w"];
    // No lock held: refused, and nothing is written.
    const refused = await cmd("EVAL", COMMIT_COMPANY_VOTE, keys.length, ...keys, "tok", "lease", "", "", "", "", "cleared", "p", "{}", "{}", "{}", "{}", "{}", "{}", 7, 50, 10, 0.6);
    expect(refused.result).toBe("lock_expired");
    expect((await cmd("EXISTS", "company:appeal:c")).result).toBe(0);
  });

  it("still refuses a script it does not know, and says so in the log", async () => {
    expect((await cmd("EVAL", "return redis.call('FLUSHALL')", 0)).status).toBe(400);
    const log = await (await fetch(`${base}/__log`)).json();
    expect(log.fake).toBe(true);
    expect(log.unknown).toEqual(["EVAL (a script this double does not know)"]);
  });
});

describe("the sign-in helper is for the TEST wallets only", () => {
  it("sets a session cookie the app accepts, for the wallet asked for", async () => {
    const r = await fetch(`${base}/__fixture/signin?as=ana`);
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^favour_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    const token = cookie.split(";")[0].split("=").slice(1).join("=");
    const saved = process.env.SESSION_SECRET;
    try {
      process.env.SESSION_SECRET = fx.sessionSecret;
      expect(verifySessionToken(token, Date.now())).toBe(fx.participants.find((p: { key: string }) => p.key === "ana").address);
      // Under any other secret, which is every deployed environment, it is refused.
      process.env.SESSION_SECRET = "some-other-secret";
      expect(verifySessionToken(token, Date.now())).toBeNull();
    } finally { process.env.SESSION_SECRET = saved; }
    expect(await r.text()).toMatch(/TEST DATA/);
  });
  it("has two distinct new participants and three reviewers, all made-up wallets", () => {
    const keys = fx.participants.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["ana", "ben", "rev1", "rev2", "rev3"]));
    const addrs = fx.participants.map((p: { address: string }) => p.address.toLowerCase());
    expect(new Set(addrs).size).toBe(addrs.length);
    for (const a of addrs) expect(a).toMatch(/^0x7e57da7a0{30}[0-9a-f]{2}$/);
  });
  it("answers 404 for anyone else", async () => {
    expect((await fetch(`${base}/__fixture/signin?as=oscar`)).status).toBe(404);
  });
  it("the start page says what it is", async () => {
    const html = await (await fetch(`${base}/__fixture/`)).text();
    expect(html).toMatch(/TEST DATA/);
    expect(html).toMatch(/No wallet here is a real person/);
  });
});

describe("the fixture writes only to the local fake", () => {
  const seed = (...args: string[]) => spawnSync(process.execPath, [join(root, "scripts", "review-fixture.mjs"), ...args], { encoding: "utf8", timeout: 20_000 });
  it.each([
    ["a remote store", ["--store", "https://example-store.upstash.io"]],
    ["a store on another host", ["--store", "http://10.0.0.5:8079"]],
    ["a remote app", ["--store", "http://127.0.0.1:8079", "--app", "https://world-relay.vercel.app"]],
  ])("refuses %s before any request", (_n, args) => {
    const r = seed(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^REFUSED:/);
  });
  it("refuses a loopback address that is not the fake", () => {
    // Nothing listens on port 59 here, so /__log cannot say "fake": true.
    const r = seed("--store", "http://127.0.0.1:59");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/did not answer as the fake store/);
  });
  it("the staged polls carry no votes and the env file carries no model key", () => {
    expect(fx.polls).toHaveLength(3);
    for (const p of [...fx.polls, ...fx.closedPolls]) expect(Object.keys(p).sort()).toEqual(["options", "question"]);
    const env = readFileSync(join(root, "scripts", "review-fixture.envfile"), "utf8");
    expect(env).not.toMatch(/ANTHROPIC|OPENROUTER|BLOB_|XMTP|DEPLOYER/);
    expect(env).toMatch(/^KV_REST_API_URL=http:\/\/127\.0\.0\.1:8079$/m);
    const script = readFileSync(join(root, "scripts", "review-fixture.mjs"), "utf8");
    expect(script).not.toMatch(/\/vote|:voters|:choices/);
  });
  it("the app launcher refuses to start beside a real env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "favour-fixture-"));
    mkdirSync(join(dir, "scripts"));
    cpSync(join(root, "scripts", "review-fixture-app.sh"), join(dir, "scripts", "review-fixture-app.sh"));
    cpSync(join(root, "scripts", "review-fixture.envfile"), join(dir, "scripts", "review-fixture.envfile"));
    writeFileSync(join(dir, ".env.local"), "ANTHROPIC_API_KEY=would-be-real\n");
    const r = spawnSync("sh", [join(dir, "scripts", "review-fixture-app.sh")], { encoding: "utf8", timeout: 10_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REFUSED: \.env\.local exists/);
  });
});
