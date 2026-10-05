#!/usr/bin/env node
// A LOCAL FAKE STORE (2026-10-05). For rehearsing the operator scripts without the
// real env file and without touching production.
//
// It speaks the small part of the Upstash REST protocol that the app's store
// client and scripts/hide-item.mjs use, keeps everything in memory, listens on
// 127.0.0.1 only, and logs every command it receives. It is seeded from a saved
// copy of the public GET /api/tasks response (and, optionally, of
// GET /api/campaigns/company). Nothing in it is real: stop it and it is gone.
//
//   node scripts/fake-store.mjs --tasks <api_tasks.json> [--campaigns <api_campaigns_company.json>] [--port 8079]
//
// Then, in another terminal, point a script at it:
//
//   node --env-file=scripts/fake-store.envfile scripts/recheck-thrown-proofs.mjs
//   curl -s http://127.0.0.1:8079/__log
//
// scripts/fake-store.envfile points a script at this fake on port 8079. It holds
// the fake's address, a made-up token, a made-up model key and the name of the
// rehearsal verifier double (scripts/rehearsal-verifier.mjs), so that a re-check
// --apply can be rehearsed all the way to the confirm code gate and beyond without
// a model. It contains no secret.
//
// GET /__log answers the command counts and how many of them were writes, so "a
// dry run sends no write" is something anyone can check.
//
// Two rehearsal aids. Plain keys expire (SET ... PX/EX, EXPIRE, PEXPIRE), so a
// lock clears by itself. And POST /__refuse with {"cmd":"SET","prefix":"rep:"}
// makes the fake refuse the next matching command once, so a failed run and its
// recovery can be rehearsed.
//
// Limits, stated plainly: it is a double, not Redis. EVAL does not run Lua. It
// recognises the three scripts this repo sends (the points lock release and the
// two hide-item compare-and-set scripts) and repeats in JavaScript what they say.
// Any other EVAL, and any command it does not know, is answered with an error and
// listed under "unknown" in /__log.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const tasksFile = arg("--tasks");
const campaignsFile = arg("--campaigns");
const port = Number(arg("--port") ?? 8079);
if (!tasksFile) { console.error("usage: fake-store.mjs --tasks <api_tasks.json> [--campaigns <api_campaigns_company.json>] [--port 8079]"); process.exit(2); }

const kv = new Map();
const sets = new Map();
const lists = new Map();
const hashes = new Map();
const zsets = new Map();
const log = [];
const unknown = [];
const WRITES = new Set(["SET", "DEL", "SADD", "SREM", "LPUSH", "LPOP", "LTRIM", "INCR", "HINCRBY", "ZINCRBY", "EVAL", "EXPIRE", "PEXPIRE"]);

const tasks = JSON.parse(readFileSync(tasksFile, "utf8")).tasks ?? [];
sets.set("task_ids", new Set(tasks.map((t) => t.id)));
for (const t of tasks) kv.set(`task:${t.id}`, JSON.stringify(t));
let campaigns = [];
if (campaignsFile) {
  campaigns = JSON.parse(readFileSync(campaignsFile, "utf8")).campaigns ?? [];
  sets.set("campaign:company:published", new Set(campaigns.map((c) => c.id)));
  for (const c of campaigns) kv.set(`campaign:draft:${c.id}`, JSON.stringify(c));
}

const str = (v) => (typeof v === "string" ? v : JSON.stringify(v));
// KEY EXPIRY (2026-10-05). SET ... PX/EX, EXPIRE and PEXPIRE are honoured for plain
// keys, so a lock left by a failed run clears by itself here as it would on Redis,
// and "wait, then run again" can be rehearsed. Sets and lists do not expire here.
const expires = new Map();
function sweep() {
  const now = Date.now();
  for (const [k, at] of expires) if (at <= now) { expires.delete(k); kv.delete(k); }
}
// REHEARSAL FAULT: POST /__refuse {"cmd":"SET","prefix":"rep:"} makes the fake
// refuse the next matching command, once. It lets a failed run be rehearsed.
let refuse = null;
function exec(args) {
  const [raw, key, ...rest] = args;
  const cmd = String(raw).toUpperCase();
  sweep();
  log.push(cmd);
  if (refuse && cmd === refuse.cmd && String(cmd === "EVAL" ? rest[1] ?? "" : key).startsWith(refuse.prefix)) {
    refuse = null;
    throw new Error("fake-store: this command was refused on request (rehearsal fault)");
  }
  switch (cmd) {
    case "GET": return kv.get(key) ?? null;
    case "SET": {
      const opts = rest.slice(1).map((x) => String(x).toUpperCase());
      if (opts.includes("NX") && kv.has(key)) return null;
      kv.set(key, str(rest[0]));
      expires.delete(key);
      const px = opts.indexOf("PX"), ex = opts.indexOf("EX");
      if (px >= 0) expires.set(key, Date.now() + Number(opts[px + 1]));
      else if (ex >= 0) expires.set(key, Date.now() + Number(opts[ex + 1]) * 1000);
      return "OK";
    }
    case "DEL": expires.delete(key); return kv.delete(key) ? 1 : 0;
    case "EXPIRE": if (kv.has(key)) expires.set(key, Date.now() + Number(rest[0]) * 1000); return 1;
    case "PEXPIRE": if (kv.has(key)) expires.set(key, Date.now() + Number(rest[0])); return 1;
    case "INCR": { const n = Number(kv.get(key) ?? 0) + 1; kv.set(key, String(n)); return n; }
    case "SADD": { if (!sets.has(key)) sets.set(key, new Set()); let n = 0; for (const m of rest) { if (!sets.get(key).has(str(m))) n++; sets.get(key).add(str(m)); } return n; }
    case "SREM": { let n = 0; for (const m of rest) if (sets.get(key)?.delete(str(m))) n++; return n; }
    case "SMEMBERS": return [...(sets.get(key) ?? [])];
    case "SISMEMBER": return sets.get(key)?.has(str(rest[0])) ? 1 : 0;
    case "LPUSH": { if (!lists.has(key)) lists.set(key, []); for (const v of rest) lists.get(key).unshift(str(v)); return lists.get(key).length; }
    case "LPOP": return (lists.get(key) ?? []).shift() ?? null;
    case "LINDEX": return (lists.get(key) ?? [])[Number(rest[0])] ?? null;
    case "LTRIM": return "OK";
    case "LRANGE": { const l = lists.get(key) ?? []; const b = Number(rest[1]); return l.slice(Number(rest[0]), b < 0 ? undefined : b + 1); }
    case "HINCRBY": { if (!hashes.has(key)) hashes.set(key, new Map()); const h = hashes.get(key); const n = (h.get(str(rest[0])) ?? 0) + Number(rest[1]); h.set(str(rest[0]), n); return n; }
    case "ZINCRBY": { if (!zsets.has(key)) zsets.set(key, new Map()); const z = zsets.get(key); const n = (z.get(str(rest[1])) ?? 0) + Number(rest[0]); z.set(str(rest[1]), n); return n; }
    case "EVAL": {
      const script = String(key);
      // EVAL script numkeys key... arg...
      const [, k1, ...more] = rest;
      if (script.includes("hide-item:cas-hide") || script.includes("hide-item:cas-undo")) {
        const [backupKey, expected, next, entry] = more;
        if ((kv.get(k1) ?? null) !== expected) return 0;
        const stack = lists.get(backupKey) ?? [];
        if (script.includes("cas-hide")) lists.set(backupKey, [entry, ...stack]);
        else if (entry !== "") { if (stack[0] !== entry) return 0; lists.set(backupKey, stack.slice(1)); }
        kv.set(k1, next);
        return 1;
      }
      if (script.includes("redis.call('get', KEYS[1]) == ARGV[1]") && script.includes("redis.call('del', KEYS[1])")) {
        if (kv.get(k1) === more[0]) { kv.delete(k1); return 1; }
        return 0;
      }
      unknown.push("EVAL (a script this double does not know)");
      throw new Error("fake-store: unknown EVAL script");
    }
    default:
      unknown.push(cmd);
      throw new Error(`fake-store: unknown command ${cmd}`);
  }
}
const b64 = (v) => (typeof v === "string" ? Buffer.from(v, "utf8").toString("base64") : Array.isArray(v) ? v.map(b64) : v);

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET" && req.url === "/__log") {
    const counts = {};
    for (const c of log) counts[c] = (counts[c] ?? 0) + 1;
    res.end(JSON.stringify({ fake: true, commands: log.length, writes: log.filter((c) => WRITES.has(c)).length, counts, unknown, seeded: { tasks: tasks.length, campaigns: campaigns.length } }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__refuse") {
      const r = JSON.parse(body || "{}");
      refuse = { cmd: String(r.cmd ?? "").toUpperCase(), prefix: String(r.prefix ?? "") };
      res.end(JSON.stringify({ fake: true, willRefuseNext: refuse }));
      return;
    }
    try {
      const parsed = JSON.parse(body);
      const enc = req.headers["upstash-encoding"] === "base64" ? b64 : (v) => v;
      const batch = req.url?.includes("pipeline") || req.url?.includes("multi-exec");
      res.end(JSON.stringify(batch ? parsed.map((c) => ({ result: enc(exec(c)) })) : { result: enc(exec(parsed)) }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});
server.listen(port, "127.0.0.1", () => {
  const a = server.address();
  console.log(`LOCAL FAKE STORE on http://127.0.0.1:${a.port}  (seeded: ${tasks.length} tasks, ${campaigns.length} campaigns; in memory only; not production)`);
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
