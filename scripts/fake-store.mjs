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
//
// THE APP ON THE FAKE (2026-10-05). The fake can also back the running app for a
// local review with TEST DATA: start it with --empty (no snapshot needed), point
// the app at it, and seed it with scripts/review-fixture.mjs. For that it now
// also answers the hash, counter and list commands the app sends, and the one
// read-with-hash script (src/lib/redis-snapshot.ts). With --fixture <file> it
// serves a small sign-in helper under /__fixture/ for the TEST DATA wallets named
// in that file. See scripts/REVIEW-FIXTURE.md. It still listens on 127.0.0.1 only.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const tasksFile = arg("--tasks");
const campaignsFile = arg("--campaigns");
const port = Number(arg("--port") ?? 8079);
const empty = argv.includes("--empty");
const fixtureFile = arg("--fixture");
if (!tasksFile && !empty) { console.error("usage: fake-store.mjs (--tasks <api_tasks.json> | --empty) [--campaigns <api_campaigns_company.json>] [--fixture <review-fixture.json>] [--port 8079]"); process.exit(2); }
const fixture = fixtureFile ? JSON.parse(readFileSync(fixtureFile, "utf8")) : null;

const kv = new Map();
const sets = new Map();
const lists = new Map();
const hashes = new Map();
const zsets = new Map();
const log = [];
const unknown = [];
const WRITES = new Set(["SET", "DEL", "SADD", "SREM", "LPUSH", "RPUSH", "LPOP", "LTRIM", "INCR", "INCRBY", "DECR", "HSET", "HSETNX", "HDEL", "HINCRBY", "ZINCRBY", "EVAL", "EXPIRE", "PEXPIRE"]);

const tasks = tasksFile ? JSON.parse(readFileSync(tasksFile, "utf8")).tasks ?? [] : [];
sets.set("task_ids", new Set(tasks.map((t) => t.id)));
for (const t of tasks) kv.set(`task:${t.id}`, JSON.stringify(t));
let campaigns = [];
if (campaignsFile) {
  campaigns = JSON.parse(readFileSync(campaignsFile, "utf8")).campaigns ?? [];
  sets.set("campaign:company:published", new Set(campaigns.map((c) => c.id)));
  for (const c of campaigns) kv.set(`campaign:draft:${c.id}`, JSON.stringify(c));
}

const str = (v) => (typeof v === "string" ? v : JSON.stringify(v));
// What Redis TYPE answers for a key.
const typeOf = (k) => (kv.has(k) ? "string" : sets.has(k) ? "set" : lists.has(k) ? "list" : hashes.has(k) ? "hash" : zsets.has(k) ? "zset" : "none");
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
    case "DEL": {
      let n = 0;
      for (const k of [key, ...rest]) {
        expires.delete(k);
        const had = kv.delete(k) | sets.delete(k) | lists.delete(k) | hashes.delete(k) | zsets.delete(k);
        if (had) n++;
      }
      return n;
    }
    case "EXISTS": return [key, ...rest].filter((k) => kv.has(k) || sets.has(k) || lists.has(k) || hashes.has(k) || zsets.has(k)).length;
    case "MGET": return [key, ...rest].map((k) => kv.get(k) ?? null);
    case "TTL": return expires.has(key) ? Math.max(0, Math.ceil((expires.get(key) - Date.now()) / 1000)) : kv.has(key) ? -1 : -2;
    case "KEYS": {
      // Prefix patterns only ("rep:*"), which is all the app sends.
      const p = String(key).replace(/\*$/, "");
      return [...new Set([...kv.keys(), ...sets.keys(), ...lists.keys(), ...hashes.keys(), ...zsets.keys()])].filter((k) => k.startsWith(p));
    }
    case "SCAN": {
      // SCAN cursor [MATCH pattern] [COUNT n]. Everything comes back in one page
      // (cursor "0"), which the protocol allows. Prefix patterns only.
      const opts = rest.map(String);
      const m = opts.findIndex((x) => x.toUpperCase() === "MATCH");
      const p = m >= 0 ? opts[m + 1].replace(/\*$/, "") : "";
      return ["0", [...new Set([...kv.keys(), ...sets.keys(), ...lists.keys(), ...hashes.keys(), ...zsets.keys()])].filter((k) => k.startsWith(p))];
    }
    case "TYPE": return typeOf(key);
    case "INCRBY": { const n = Number(kv.get(key) ?? 0) + Number(rest[0]); kv.set(key, String(n)); return n; }
    case "DECR": { const n = Number(kv.get(key) ?? 0) - 1; kv.set(key, String(n)); return n; }
    case "SCARD": return sets.get(key)?.size ?? 0;
    case "RPUSH": { if (!lists.has(key)) lists.set(key, []); for (const v of rest) lists.get(key).push(str(v)); return lists.get(key).length; }
    case "LLEN": return (lists.get(key) ?? []).length;
    case "ZSCORE": { const v = zsets.get(key)?.get(str(rest[0])); return v === undefined ? null : String(v); }
    case "HSET": {
      if (!hashes.has(key)) hashes.set(key, new Map());
      let n = 0;
      for (let i = 0; i + 1 < rest.length; i += 2) { if (!hashes.get(key).has(str(rest[i]))) n++; hashes.get(key).set(str(rest[i]), str(rest[i + 1])); }
      return n;
    }
    case "HSETNX": {
      if (!hashes.has(key)) hashes.set(key, new Map());
      if (hashes.get(key).has(str(rest[0]))) return 0;
      hashes.get(key).set(str(rest[0]), str(rest[1]));
      return 1;
    }
    case "HGET": { const v = hashes.get(key)?.get(str(rest[0])); return v === undefined ? null : String(v); }
    case "HDEL": { let n = 0; for (const f of rest) if (hashes.get(key)?.delete(str(f))) n++; return n; }
    // A flat [field, value, ...] list, which is what the REST client expects.
    case "HGETALL": { const out = []; for (const [f, v] of hashes.get(key) ?? []) out.push(f, String(v)); return out; }
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
    case "LTRIM": { const l = lists.get(key); if (l) { const b = Number(rest[1]); lists.set(key, l.slice(Number(rest[0]), b < 0 ? undefined : b + 1)); } return "OK"; }
    case "LRANGE": { const l = lists.get(key) ?? []; const b = Number(rest[1]); return l.slice(Number(rest[0]), b < 0 ? undefined : b + 1); }
    case "HINCRBY": { if (!hashes.has(key)) hashes.set(key, new Map()); const h = hashes.get(key); const n = Number(h.get(str(rest[0])) ?? 0) + Number(rest[1]); h.set(str(rest[0]), n); return n; }
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
      // The read-with-hash script (src/lib/redis-snapshot.ts): the value and the
      // SHA-1 of its exact bytes, or two empty strings when the key is absent.
      if (script.includes("redis.sha1hex(v)") && script.includes("redis.call('GET', KEYS[1])")) {
        const v = kv.get(k1);
        return v === undefined ? ["", ""] : [v, createHash("sha1").update(v).digest("hex")];
      }
      // A token-checked lock release written with capital GET and DEL
      // (src/lib/company-appeal.ts). Same rule as the lowercase one above.
      if (/redis\.call\('GET',\s*KEYS\[1\]\)\s*==\s*ARGV\[1\]/.test(script) && /redis\.call\('DEL',\s*KEYS\[1\]\)/.test(script) && !script.includes("lock_expired")) {
        if (kv.get(k1) === str(more[0])) { kv.delete(k1); expires.delete(k1); return 1; }
        return 0;
      }
      // THE COMPANY REVIEW SCRIPTS (src/lib/company-appeal.ts), repeated here in
      // JavaScript line for line. The rules are the app's, not this file's:
      // src/__tests__/company-review-scripts.real-redis.test.ts runs the real Lua
      // on a real Redis and this double with the same inputs, and compares the
      // answer and every key they leave behind.
      if (script.includes("Review store type mismatch")) {
        const n = Number(rest[0]);
        const KK = [k1, ...more.slice(0, n - 1)];
        const AA = more.slice(n - 1).map(str);
        for (let i = 0; i < 3; i++) {
          const t = typeOf(KK[i]);
          if (t !== "none" && t !== (i === 0 ? "string" : "set")) throw new Error("Review store type mismatch");
        }
        if (!kv.has(KK[0])) {
          kv.set(KK[0], AA[0]);
          for (const k of [KK[1], KK[2]]) { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(AA[1]); }
        }
        return 1;
      }
      if (script.includes("lock_expired") && script.includes("already_completed")) {
        const n = Number(rest[0]);
        const KK = [k1, ...more.slice(0, n - 1)];
        const AA = more.slice(n - 1).map(str);
        const expected = ["string", "string", "string", "string", "string", "string", "hash", "set", "list", "list", "list", "set", "set", "zset"];
        for (let i = 0; i < KK.length; i++) { const t = typeOf(KK[i]); if (t !== "none" && t !== expected[i]) return "storage_type"; }
        if (kv.get(KK[0]) !== AA[0] || kv.get(KK[1]) !== AA[1]) return "lock_expired";
        for (let i = 2; i <= 5; i++) {
          const raw = kv.get(KK[i]);
          if ((raw === undefined ? "" : createHash("sha1").update(raw).digest("hex")) !== AA[i]) return "changed";
        }
        const judged = Number(hashes.get(KK[6])?.get("judged") ?? 0);
        const correct = Number(hashes.get(KK[6])?.get("correct") ?? 0);
        if (Number.isNaN(judged) || Number.isNaN(correct) || judged < Number(AA[16]) || correct / judged < Number(AA[17])) return "unqualified";
        if (AA[6] === "cleared" && sets.get(KK[7])?.has(AA[7])) return "already_completed";
        const push = (k, v, keep) => { const l = [v, ...(lists.get(k) ?? [])]; lists.set(k, keep === undefined ? l : l.slice(0, keep)); };
        const add = (k, v) => { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(v); };
        kv.set(KK[3], AA[8]);
        if (AA[6] !== "pending") {
          kv.set(KK[2], AA[9]);
          push(KK[9], AA[10], 100);
          push(KK[10], AA[11]);
          if (AA[6] === "cleared") {
            add(KK[7], AA[7]);
            push(KK[8], AA[12], Number(AA[15]));
            kv.set(KK[5], AA[13]);
            add(KK[12], AA[7]);
            if (!zsets.has(KK[13])) zsets.set(KK[13], new Map());
            zsets.get(KK[13]).set(AA[7], (zsets.get(KK[13]).get(AA[7]) ?? 0) + Number(AA[14]));
          } else add(KK[11], AA[7]);
        }
        return "ok";
      }
      // The three review scripts (src/lib/house-review.ts and proof-of-favour.ts),
      // repeated here in JavaScript. KEYS are k1 and the next (numkeys - 1) items.
      const nk = Number(rest[0]);
      const K = [k1, ...more.slice(0, nk - 1)];
      const A = more.slice(nk - 1).map(str);
      if (script.startsWith("-- favour:case-slot")) {
        if (kv.has(K[1])) return kv.get(K[1]);
        if (!sets.has(K[0])) sets.set(K[0], new Set());
        const had = sets.get(K[0]).has(A[0]);
        sets.get(K[0]).add(A[0]);
        kv.set(K[1], had ? "none" : "credit");
        return kv.get(K[1]);
      }
      if (script.startsWith("-- favour:case-history")) {
        if (kv.has(K[0])) return 0;
        kv.set(K[0], A[0]);
        lists.set(K[1], [A[1], ...(lists.get(K[1]) ?? [])].slice(0, Number(A[2])));
        return 1;
      }
      if (script.startsWith("-- favour:keyed-credit")) {
        if (kv.get(K[3]) !== A[4]) return "lock";
        const raw = kv.get(K[0]);
        if ((raw === undefined ? "" : createHash("sha1").update(raw).digest("hex")) !== A[0]) return "changed";
        kv.set(K[0], A[1]);
        if (!sets.has(K[1])) sets.set(K[1], new Set());
        sets.get(K[1]).add(A[2]);
        if (!zsets.has(K[2])) zsets.set(K[2], new Map());
        zsets.get(K[2]).set(A[2], (zsets.get(K[2]).get(A[2]) ?? 0) + Number(A[3]));
        return "ok";
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

// THE SIGN-IN HELPER, for a local review only. A browser on a laptop cannot do a
// World wallet sign-in, and the app (correctly) gives an unsigned preview
// identity no session. This page sets the session cookie for one of the TEST
// DATA wallets named in the fixture file, signed with the fixture's own made-up
// secret, and the two local storage values the app reads. It is served by this
// fake only, on 127.0.0.1. The app has no route that does this.
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function sessionToken(address) {
  const payload = `${address.toLowerCase()}.${Date.now() + 30 * 24 * 3600_000}`;
  const sig = createHmac("sha256", fixture.sessionSecret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}
const APP_KEYS = ["relay_user_id", "relay_verification_level", "relay_onboarded", "relay_terms_accepted", "relay_first_run_coach_dismissed", "favour_pending_mission", "favour_pending_launch", "favour_pending_piece", "favour_pending_welcome", "favour_jury_intro_seen", "favour_loop_arrived", "favour_last_visit"];
function fixturePage(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (!fixture) { res.statusCode = 404; res.end("<p>No fixture file was given to the fake store (--fixture).</p>"); return; }
  const url = new URL(req.url, "http://127.0.0.1");
  const style = "<style>body{font:16px/1.4 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#111}a.b{display:block;margin:.5rem 0;padding:.9rem 1rem;border:1px solid #111;border-radius:999px;text-decoration:none;color:#111;font-weight:600}small{color:#555}.t{background:#111;color:#fff;padding:.4rem .8rem;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.15em}</style>";
  if (url.pathname === "/__fixture/signin") {
    const who = fixture.participants.find((p) => p.key === url.searchParams.get("as"));
    if (!who) { res.statusCode = 404; res.end(`${style}<p>No such TEST DATA participant.</p>`); return; }
    res.setHeader("Set-Cookie", `favour_session=${sessionToken(who.address)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    res.end(`${style}<p><span class="t">TEST DATA</span></p><p>Signing in as ${esc(who.name)}.</p><script>
      try { ${JSON.stringify(APP_KEYS)}.forEach(function (k) { localStorage.removeItem(k); });
        localStorage.setItem("relay_user_id", ${JSON.stringify(who.address)});
        localStorage.setItem("relay_verification_level", "wallet");
        localStorage.setItem("relay_onboarded", "true"); } catch (e) {}
      location.replace("/");
    </script>`);
    return;
  }
  if (url.pathname === "/__fixture/signout") {
    res.setHeader("Set-Cookie", "favour_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    res.end(`${style}<p><span class="t">TEST DATA</span></p><p>Signed out. Opening the first visit screen.</p><script>
      try { ${JSON.stringify(APP_KEYS)}.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
      location.replace("/");
    </script>`);
    return;
  }
  res.end(`${style}<p><span class="t">TEST DATA</span></p><h1>FAVOUR local review</h1>
    <p>Everything in this preview is test data in a store that lives in memory on this machine. No wallet here is a real person. Nothing is sent anywhere.</p>
    <a class="b" href="/__fixture/signout">First visit (signed out)</a>
    ${fixture.participants.map((p) => `<a class="b" href="/__fixture/signin?as=${esc(p.key)}">Sign in as ${esc(p.name)}<br><small>${esc(p.role)}</small></a>`).join("")}`);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET" && req.url === "/__log") {
    const counts = {};
    for (const c of log) counts[c] = (counts[c] ?? 0) + 1;
    res.end(JSON.stringify({ fake: true, commands: log.length, writes: log.filter((c) => WRITES.has(c)).length, counts, unknown, seeded: { tasks: tasks.length, campaigns: campaigns.length } }));
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/__fixture")) {
    fixturePage(req, res);
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
  console.log(`LOCAL FAKE STORE on http://127.0.0.1:${a.port}  (seeded: ${tasks.length} tasks, ${campaigns.length} campaigns; in memory only; not production)${fixture ? "  TEST DATA sign-in helper on /__fixture/" : ""}`);
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
