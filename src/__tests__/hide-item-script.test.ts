import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// R16: runs the REAL operator script against a fake Upstash REST endpoint, so the
// dry run, --apply, --undo and the campaign-to-pieces cascade are exercised, not
// read. The fake speaks the one shape the script uses: POST ["CMD", ...args].
const run = promisify(execFile);
let server: Server;
let url = "";
let kv: Map<string, string>;
const sets = new Map<string, string[]>();
const lists = new Map<string, string[]>();
// Runs once, right after the script's first GET of this key: stands for a claim,
// a proof or a cron write landing between the script's read and its write.
let between: { key: string; change: (raw: string) => string } | null = null;
const seen: string[] = [];

beforeEach(async () => {
  lists.clear(); between = null; seen.length = 0;
  kv = new Map();
  kv.set("campaign:draft:c1", JSON.stringify({ id: "c1", status: "published", company: "kcz", brief: "just want to make money", pieceTaskIds: { ugc: "p1", review: "p2" } }));
  kv.set("task:p1", JSON.stringify({ id: "p1", status: "open", completionCount: 0 }));
  kv.set("task:p2", JSON.stringify({ id: "p2", status: "open", completionCount: 0 }));
  kv.set("campaign:draft:d1", JSON.stringify({ id: "d1", status: "draft", company: "x", brief: "y" }));
  sets.set("campaign:company:published", ["c1"]);
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const args = JSON.parse(body) as string[];
      const [cmd, key, val] = args;
      seen.push(cmd);
      let result: unknown = null;
      if (cmd === "GET") {
        result = kv.get(key) ?? null;
        if (between && between.key === key && kv.has(key)) { kv.set(key, between.change(kv.get(key)!)); between = null; }
      }
      if (cmd === "SET") { kv.set(key, val); result = "OK"; }
      if (cmd === "SMEMBERS") result = sets.get(key) ?? [];
      if (cmd === "LRANGE") result = (lists.get(key) ?? []).slice(Number(args[2]), Number(args[3]) < 0 ? undefined : Number(args[3]) + 1);
      if (cmd === "LINDEX") result = (lists.get(key) ?? [])[Number(args[2])] ?? null;
      if (cmd === "EVAL") {
        // LOCAL DOUBLE of the two compare-and-set scripts. No Lua runs here: this
        // repeats in JavaScript what the Lua text says. EVAL script numkeys key backup expected next entry
        const [, script, , k, backupKey, expected, next, entry] = args;
        const current = kv.get(k) ?? null;
        if (current !== expected) result = 0;
        else if (script.includes("hide-item:cas-hide")) {
          lists.set(backupKey, [entry, ...(lists.get(backupKey) ?? [])]);
          kv.set(k, next);
          result = 1;
        } else if (script.includes("hide-item:cas-undo")) {
          if (entry !== "" && (lists.get(backupKey) ?? [])[0] !== entry) result = 0;
          else {
            if (entry !== "") lists.set(backupKey, (lists.get(backupKey) ?? []).slice(1));
            kv.set(k, next);
            result = 1;
          }
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const hide = (...args: string[]) =>
  run("node", ["scripts/hide-item.mjs", ...args], { env: { ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: "t" } });
const rec = (k: string) => JSON.parse(kv.get(k)!);

describe("scripts/hide-item.mjs", () => {
  it("a dry run writes nothing", async () => {
    await hide("campaign", "c1");
    expect(rec("campaign:draft:c1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
  it("--apply hides the campaign and every piece, and keeps every other field", async () => {
    await hide("campaign", "c1", "--reason", "spam", "--apply");
    for (const k of ["campaign:draft:c1", "task:p1", "task:p2"]) {
      expect(typeof rec(k).hiddenAt).toBe("string");
      expect(rec(k).hiddenReason).toBe("spam");
    }
    expect(rec("campaign:draft:c1").brief).toBe("just want to make money");
    expect(rec("task:p1").status).toBe("open");
  });
  it("--undo with --apply restores it", async () => {
    await hide("campaign", "c1", "--apply");
    await hide("campaign", "c1", "--undo", "--apply");
    for (const k of ["campaign:draft:c1", "task:p1", "task:p2"]) expect(rec(k).hiddenAt).toBeUndefined();
  });

  // Cold walk, 5 Oct 2026. The four faults found in this script, one test each.
  it("--undo is a dry run until --apply: it writes nothing", async () => {
    await hide("task", "p1", "--apply");
    const before = kv.get("task:p1");
    const writesBefore = seen.filter((c) => c === "SET" || c === "EVAL").length;
    const r = await hide("task", "p1", "--undo");
    expect(kv.get("task:p1")).toBe(before);
    expect(typeof rec("task:p1").hiddenAt).toBe("string");
    expect(seen.filter((c) => c === "SET" || c === "EVAL").length).toBe(writesBefore);
    expect(r.stdout).toContain("Dry run");
  });

  it("saves the exact prior record before it writes", async () => {
    const prior = kv.get("task:p1")!;
    await hide("task", "p1", "--reason", "spam", "--apply");
    const saved = (lists.get("hide:backup:task:p1") ?? []).map((x) => JSON.parse(x));
    expect(saved).toHaveLength(1);
    expect(saved[0].prior).toBe(prior);
    expect(saved[0].action).toBe("hide");
  });

  it("undo restores exactly the prior hidden state: an item hidden earlier stays hidden for its first reason", async () => {
    await hide("task", "p1", "--reason", "first: spam", "--apply");
    const first = rec("task:p1");
    await hide("task", "p1", "--reason", "second: stale", "--apply");
    expect(rec("task:p1").hiddenReason).toBe("second: stale");
    await hide("task", "p1", "--undo", "--apply");
    expect(rec("task:p1").hiddenReason).toBe("first: spam");
    expect(rec("task:p1").hiddenAt).toBe(first.hiddenAt);
    await hide("task", "p1", "--undo", "--apply");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenReason).toBeUndefined();
  });

  it("undoing a campaign leaves a piece that was hidden separately before still hidden", async () => {
    await hide("task", "p2", "--reason", "piece: broken", "--apply");
    await hide("campaign", "c1", "--reason", "campaign: ended", "--apply");
    await hide("campaign", "c1", "--undo", "--apply");
    expect(rec("campaign:draft:c1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(rec("task:p2").hiddenReason).toBe("piece: broken");
  });

  it("fails, and loses nothing, if the record changed between its read and its write", async () => {
    // Someone claims the favour in the window.
    between = { key: "task:p1", change: (raw) => JSON.stringify({ ...JSON.parse(raw), status: "claimed", claimant: "0xabc" }) };
    await expect(hide("task", "p1", "--apply")).rejects.toMatchObject({ code: 1 });
    expect(rec("task:p1")).toMatchObject({ status: "claimed", claimant: "0xabc" });
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(lists.get("hide:backup:task:p1") ?? []).toHaveLength(0);
  });

  it("the same guard holds for undo", async () => {
    await hide("task", "p1", "--apply");
    between = { key: "task:p1", change: (raw) => JSON.stringify({ ...JSON.parse(raw), completionCount: 3 }) };
    await expect(hide("task", "p1", "--undo", "--apply")).rejects.toMatchObject({ code: 1 });
    expect(rec("task:p1").completionCount).toBe(3);
    expect(typeof rec("task:p1").hiddenAt).toBe("string");
    expect(lists.get("hide:backup:task:p1")).toHaveLength(1);
  });

  it("only the hidden fields move: a change made after the hide survives the undo", async () => {
    await hide("task", "p1", "--apply");
    kv.set("task:p1", JSON.stringify({ ...rec("task:p1"), completionCount: 2 }));
    await hide("task", "p1", "--undo", "--apply");
    expect(rec("task:p1").completionCount).toBe(2);
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });

  it("hiding again with the same reason writes nothing, so a campaign hide can be re-run", async () => {
    await hide("campaign", "c1", "--reason", "ended", "--apply");
    const before = [kv.get("campaign:draft:c1"), kv.get("task:p1"), kv.get("task:p2")];
    await hide("campaign", "c1", "--reason", "ended", "--apply");
    expect([kv.get("campaign:draft:c1"), kv.get("task:p1"), kv.get("task:p2")]).toEqual(before);
    expect(lists.get("hide:backup:task:p1")).toHaveLength(1);
  });

  it("an item hidden by the old script has no saved state: undo says so and makes it visible", async () => {
    kv.set("task:p1", JSON.stringify({ ...rec("task:p1"), hiddenAt: "2026-09-25T10:00:00.000Z", hiddenReason: "old" }));
    const dry = await hide("task", "p1", "--undo");
    expect(dry.stdout).toContain("no saved prior state");
    await hide("task", "p1", "--undo", "--apply");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
  it("refuses a private draft and writes nothing", async () => {
    await expect(hide("campaign", "d1", "--apply")).rejects.toBeTruthy();
    expect(rec("campaign:draft:d1").hiddenAt).toBeUndefined();
  });
  it("hides a single task", async () => {
    await hide("task", "p2", "--apply");
    expect(typeof rec("task:p2").hiddenAt).toBe("string");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
});
