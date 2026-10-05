import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      // GET /__log is how the script asks a local store whether it is the shipped
      // rehearsal fake. This test double is not, and says so.
      if (req.method === "GET") { res.statusCode = 404; res.end("{}"); return; }
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

// The dry runs here leave code records; keep them in a folder of this test's own.
const CODES = mkdtempSync(join(tmpdir(), "hide-item-codes-"));
const hide = (...args: string[]) =>
  run("node", ["scripts/hide-item.mjs", ...args], { env: { ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: "t", FAVOUR_CONFIRM_DIR: CODES } });
// A write the way the operator must do it since 5 Oct: the dry run first, then the
// same command with --apply and the code the dry run printed.
const codeOf = (out: string) => out.match(/--apply --confirm ([0-9a-f]+)/)?.[1];
async function apply(...args: string[]) {
  const dry = await hide(...args);
  const code = codeOf(dry.stdout);
  if (!code) return dry;
  return hide(...args, "--apply", "--confirm", code);
}
const rec = (k: string) => JSON.parse(kv.get(k)!);

describe("scripts/hide-item.mjs", () => {
  it("a dry run writes nothing", async () => {
    await hide("campaign", "c1");
    expect(rec("campaign:draft:c1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
  it("--apply hides the campaign and every piece, and keeps every other field", async () => {
    await apply("campaign", "c1", "--reason", "spam");
    for (const k of ["campaign:draft:c1", "task:p1", "task:p2"]) {
      expect(typeof rec(k).hiddenAt).toBe("string");
      expect(rec(k).hiddenReason).toBe("spam");
    }
    expect(rec("campaign:draft:c1").brief).toBe("just want to make money");
    expect(rec("task:p1").status).toBe("open");
  });
  it("--undo with --apply restores it", async () => {
    await apply("campaign", "c1");
    await apply("campaign", "c1", "--undo");
    for (const k of ["campaign:draft:c1", "task:p1", "task:p2"]) expect(rec(k).hiddenAt).toBeUndefined();
  });

  // Cold walk, 5 Oct 2026. The four faults found in this script, one test each.
  it("--undo is a dry run until --apply: it writes nothing", async () => {
    await apply("task", "p1");
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
    await apply("task", "p1", "--reason", "spam");
    const saved = (lists.get("hide:backup:task:p1") ?? []).map((x) => JSON.parse(x));
    expect(saved).toHaveLength(1);
    expect(saved[0].prior).toBe(prior);
    expect(saved[0].action).toBe("hide");
  });

  it("undo restores exactly the prior hidden state: an item hidden earlier stays hidden for its first reason", async () => {
    await apply("task", "p1", "--reason", "first: spam");
    const first = rec("task:p1");
    await apply("task", "p1", "--reason", "second: stale");
    expect(rec("task:p1").hiddenReason).toBe("second: stale");
    await apply("task", "p1", "--undo");
    expect(rec("task:p1").hiddenReason).toBe("first: spam");
    expect(rec("task:p1").hiddenAt).toBe(first.hiddenAt);
    await apply("task", "p1", "--undo");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenReason).toBeUndefined();
  });

  it("undoing a campaign leaves a piece that was hidden separately before still hidden", async () => {
    await apply("task", "p2", "--reason", "piece: broken");
    await apply("campaign", "c1", "--reason", "campaign: ended");
    await apply("campaign", "c1", "--undo");
    expect(rec("campaign:draft:c1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(rec("task:p2").hiddenReason).toBe("piece: broken");
  });

  it("fails, and loses nothing, if the record changed between its read and its write", async () => {
    // Someone claims the favour in the window.
    // The dry run is read and its code copied. Then, between the apply run's own
    // read and its write, the claim lands. The code still matches; the store refuses.
    const code = codeOf((await hide("task", "p1")).stdout)!;
    between = { key: "task:p1", change: (raw) => JSON.stringify({ ...JSON.parse(raw), status: "claimed", claimant: "0xabc" }) };
    await expect(hide("task", "p1", "--apply", "--confirm", code)).rejects.toMatchObject({ code: 1 });
    expect(rec("task:p1")).toMatchObject({ status: "claimed", claimant: "0xabc" });
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(lists.get("hide:backup:task:p1") ?? []).toHaveLength(0);
  });

  it("the same guard holds for undo", async () => {
    await apply("task", "p1");
    const code = codeOf((await hide("task", "p1", "--undo")).stdout)!;
    between = { key: "task:p1", change: (raw) => JSON.stringify({ ...JSON.parse(raw), completionCount: 3 }) };
    await expect(hide("task", "p1", "--undo", "--apply", "--confirm", code)).rejects.toMatchObject({ code: 1 });
    expect(rec("task:p1").completionCount).toBe(3);
    expect(typeof rec("task:p1").hiddenAt).toBe("string");
    expect(lists.get("hide:backup:task:p1")).toHaveLength(1);
  });

  it("only the hidden fields move: a change made after the hide survives the undo", async () => {
    await apply("task", "p1");
    kv.set("task:p1", JSON.stringify({ ...rec("task:p1"), completionCount: 2 }));
    await apply("task", "p1", "--undo");
    expect(rec("task:p1").completionCount).toBe(2);
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });

  it("hiding again with the same reason writes nothing, so a campaign hide can be re-run", async () => {
    await apply("campaign", "c1", "--reason", "ended");
    const before = [kv.get("campaign:draft:c1"), kv.get("task:p1"), kv.get("task:p2")];
    await apply("campaign", "c1", "--reason", "ended");
    expect([kv.get("campaign:draft:c1"), kv.get("task:p1"), kv.get("task:p2")]).toEqual(before);
    expect(lists.get("hide:backup:task:p1")).toHaveLength(1);
  });

  it("an item hidden by the old script has no saved state: undo says so and makes it visible", async () => {
    kv.set("task:p1", JSON.stringify({ ...rec("task:p1"), hiddenAt: "2026-09-25T10:00:00.000Z", hiddenReason: "old" }));
    const dry = await hide("task", "p1", "--undo");
    expect(dry.stdout).toContain("no saved prior state");
    await apply("task", "p1", "--undo");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
  it("refuses a private draft and writes nothing", async () => {
    await expect(apply("campaign", "d1")).rejects.toBeTruthy();
    expect(rec("campaign:draft:d1").hiddenAt).toBeUndefined();
  });
  // Second cold walk, 5 Oct: a pasted block ran the dry run and the write together.
  // A write now needs a code that only the dry run of the same command prints.
  it("--apply without --confirm writes nothing and says to run the dry run first", async () => {
    const before = kv.get("task:p1");
    await expect(hide("task", "p1", "--apply")).rejects.toMatchObject({ code: 2 });
    await expect(hide("task", "p1", "--undo", "--apply")).rejects.toMatchObject({ code: 2 });
    expect(kv.get("task:p1")).toBe(before);
    expect(seen.filter((c) => c === "SET" || c === "EVAL")).toEqual([]);
  });

  it("a made-up code, or the code of a different command, writes nothing", async () => {
    const before = kv.get("task:p1");
    await expect(hide("task", "p1", "--apply", "--confirm", "0000000000")).rejects.toMatchObject({ code: 2 });
    const other = codeOf((await hide("task", "p2")).stdout)!;
    await expect(hide("task", "p1", "--apply", "--confirm", other)).rejects.toMatchObject({ code: 2 });
    const reasonA = codeOf((await hide("task", "p1", "--reason", "a")).stdout)!;
    await expect(hide("task", "p1", "--reason", "b", "--apply", "--confirm", reasonA)).rejects.toMatchObject({ code: 2 });
    // The code of a hide does not authorise an undo, and the reverse.
    await apply("task", "p1", "--reason", "a");
    const hideAgain = codeOf((await hide("task", "p1", "--reason", "c")).stdout)!;
    const hidden = kv.get("task:p1");
    await expect(hide("task", "p1", "--undo", "--apply", "--confirm", hideAgain)).rejects.toMatchObject({ code: 2 });
    expect(kv.get("task:p1")).toBe(hidden);
    expect(before).not.toBe(hidden);
  });

  it("a code goes stale when the record changes after the dry run", async () => {
    const code = codeOf((await hide("task", "p1")).stdout)!;
    kv.set("task:p1", JSON.stringify({ ...rec("task:p1"), status: "claimed", claimant: "0xabc" }));
    await expect(hide("task", "p1", "--apply", "--confirm", code)).rejects.toMatchObject({ code: 2 });
    expect(rec("task:p1").hiddenAt).toBeUndefined();
    expect(rec("task:p1").claimant).toBe("0xabc");
  });

  it("the words of a pasted shell comment are refused, not ignored", async () => {
    await expect(hide("#", "lists", "campaigns")).rejects.toMatchObject({ code: 2 });
    await expect(hide("task", "p1", "#", "dry", "run")).rejects.toMatchObject({ code: 2 });
    await expect(hide("task", "p1", "--aply")).rejects.toMatchObject({ code: 2 });
    expect(seen).toEqual([]);
  });

  it("hides a single task", async () => {
    await apply("task", "p2");
    expect(typeof rec("task:p2").hiddenAt).toBe("string");
    expect(rec("task:p1").hiddenAt).toBeUndefined();
  });
});
