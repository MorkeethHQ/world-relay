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

beforeEach(async () => {
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
      const [cmd, key, val] = JSON.parse(body);
      let result: unknown = null;
      if (cmd === "GET") result = kv.get(key) ?? null;
      if (cmd === "SET") { kv.set(key, val); result = "OK"; }
      if (cmd === "SMEMBERS") result = sets.get(key) ?? [];
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
  it("--undo restores it", async () => {
    await hide("campaign", "c1", "--apply");
    await hide("campaign", "c1", "--undo");
    for (const k of ["campaign:draft:c1", "task:p1", "task:p2"]) expect(rec(k).hiddenAt).toBeUndefined();
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
