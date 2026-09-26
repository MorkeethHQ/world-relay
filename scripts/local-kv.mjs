#!/usr/bin/env node
// LOCAL KV (2026-09-27). An in-memory stand-in for the Upstash REST API, so the
// dev server can run the whole company campaign journey WITHOUT the production
// store. .env.local in the main checkout points KV_REST_API_URL at production;
// a local walk must never write there. Point the worktree's .env.local here:
//
//   node scripts/local-kv.mjs            # listens on 127.0.0.1:8079
//   KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=local npm run dev
//
// Data lives in this process only and is gone when it exits. Test data by
// construction. Implements the commands src/ uses (grep "redis\." src), the
// /pipeline and /multi-exec paths, and base64 result encoding when the client
// asks for it (Upstash-Encoding: base64, the @upstash/redis default).

import { createServer } from "node:http";

const PORT = Number(process.env.LOCAL_KV_PORT || 8079);
const strings = new Map(); // key -> string
const sets = new Map(); // key -> Set
const lists = new Map(); // key -> array
const hashes = new Map(); // key -> Map
const zsets = new Map(); // key -> Map member -> score
const expiries = new Map(); // key -> ms epoch

function sweep(key) {
  const t = expiries.get(key);
  if (t !== undefined && Date.now() >= t) {
    expiries.delete(key);
    strings.delete(key); sets.delete(key); lists.delete(key); hashes.delete(key); zsets.delete(key);
  }
}
function exists(key) {
  sweep(key);
  return strings.has(key) || sets.has(key) || lists.has(key) || hashes.has(key) || zsets.has(key);
}
function del(key) {
  const had = exists(key);
  strings.delete(key); sets.delete(key); lists.delete(key); hashes.delete(key); zsets.delete(key); expiries.delete(key);
  return had ? 1 : 0;
}
function allKeys() {
  const out = new Set();
  for (const m of [strings, sets, lists, hashes, zsets]) for (const k of m.keys()) { sweep(k); if (exists(k)) out.add(k); }
  return [...out];
}
function glob(pattern) {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return allKeys().filter((k) => re.test(k));
}
const str = (v) => (v === null || v === undefined ? "" : String(v));

function run(args) {
  const cmd = String(args[0]).toLowerCase();
  const a = args.slice(1).map(str);
  const key = a[0];
  if (key !== undefined) sweep(key);
  switch (cmd) {
    case "ping": return "PONG";
    case "get": return strings.get(key) ?? null;
    case "set": {
      const val = a[1];
      let nx = false, xx = false, ex = null, px = null, get = false;
      for (let i = 2; i < a.length; i++) {
        const o = a[i].toUpperCase();
        if (o === "NX") nx = true; else if (o === "XX") xx = true; else if (o === "GET") get = true;
        else if (o === "EX") ex = Number(a[++i]); else if (o === "PX") px = Number(a[++i]);
        else if (o === "KEEPTTL") {}
      }
      const had = exists(key);
      if (nx && had) return null;
      if (xx && !had) return null;
      const prev = strings.get(key) ?? null;
      del(key);
      strings.set(key, val);
      if (ex !== null) expiries.set(key, Date.now() + ex * 1000);
      if (px !== null) expiries.set(key, Date.now() + px);
      return get ? prev : "OK";
    }
    case "setnx": { if (exists(key)) return 0; strings.set(key, a[1]); return 1; }
    case "del": return a.reduce((n, k) => n + del(k), 0);
    case "exists": return a.reduce((n, k) => n + (exists(k) ? 1 : 0), 0);
    case "expire": { if (!exists(key)) return 0; expiries.set(key, Date.now() + Number(a[1]) * 1000); return 1; }
    case "pexpire": { if (!exists(key)) return 0; expiries.set(key, Date.now() + Number(a[1])); return 1; }
    case "ttl": { const t = expiries.get(key); if (!exists(key)) return -2; if (t === undefined) return -1; return Math.ceil((t - Date.now()) / 1000); }
    case "incr": case "incrby": case "decr": case "decrby": {
      const by = cmd === "incr" ? 1 : cmd === "decr" ? -1 : Number(a[1]) * (cmd === "decrby" ? -1 : 1);
      const n = Number(strings.get(key) ?? 0) + by;
      strings.set(key, String(n));
      return n;
    }
    case "incrbyfloat": { const n = Number(strings.get(key) ?? 0) + Number(a[1]); strings.set(key, String(n)); return String(n); }
    case "sadd": { const s = sets.get(key) ?? new Set(); let n = 0; for (const m of a.slice(1)) { if (!s.has(m)) { s.add(m); n++; } } sets.set(key, s); return n; }
    case "srem": { const s = sets.get(key); if (!s) return 0; let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++; if (s.size === 0) sets.delete(key); return n; }
    case "smembers": return [...(sets.get(key) ?? [])];
    case "scard": return (sets.get(key) ?? new Set()).size;
    case "sismember": return (sets.get(key) ?? new Set()).has(a[1]) ? 1 : 0;
    case "sinter": { const [first, ...rest] = a.map((k) => sets.get(k) ?? new Set()); return [...first].filter((m) => rest.every((s) => s.has(m))); }
    case "lpush": { const l = lists.get(key) ?? []; for (const v of a.slice(1)) l.unshift(v); lists.set(key, l); return l.length; }
    case "rpush": { const l = lists.get(key) ?? []; for (const v of a.slice(1)) l.push(v); lists.set(key, l); return l.length; }
    case "lrange": { const l = lists.get(key) ?? []; let s = Number(a[1]), e = Number(a[2]); if (s < 0) s = Math.max(0, l.length + s); if (e < 0) e = l.length + e; return l.slice(s, e + 1); }
    case "ltrim": { const l = lists.get(key) ?? []; let s = Number(a[1]), e = Number(a[2]); if (s < 0) s = Math.max(0, l.length + s); if (e < 0) e = l.length + e; lists.set(key, l.slice(s, e + 1)); return "OK"; }
    case "lset": { const l = lists.get(key); if (!l) throw new Error("ERR no such key"); let i = Number(a[1]); if (i < 0) i = l.length + i; if (i < 0 || i >= l.length) throw new Error("ERR index out of range"); l[i] = a[2]; return "OK"; }
    case "llen": return (lists.get(key) ?? []).length;
    case "hset": { const h = hashes.get(key) ?? new Map(); let n = 0; for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], a[i + 1]); } hashes.set(key, h); return n; }
    case "hsetnx": { const h = hashes.get(key) ?? new Map(); if (h.has(a[1])) return 0; h.set(a[1], a[2]); hashes.set(key, h); return 1; }
    case "hget": return hashes.get(key)?.get(a[1]) ?? null;
    case "hdel": { const h = hashes.get(key); if (!h) return 0; let n = 0; for (const f of a.slice(1)) if (h.delete(f)) n++; return n; }
    case "hkeys": return [...(hashes.get(key)?.keys() ?? [])];
    case "hgetall": { const h = hashes.get(key); if (!h) return []; const out = []; for (const [f, v] of h) out.push(f, v); return out; }
    case "hincrby": { const h = hashes.get(key) ?? new Map(); const n = Number(h.get(a[1]) ?? 0) + Number(a[2]); h.set(a[1], String(n)); hashes.set(key, h); return n; }
    case "zincrby": { const z = zsets.get(key) ?? new Map(); const n = Number(z.get(a[2]) ?? 0) + Number(a[1]); z.set(a[2], n); zsets.set(key, z); return String(n); }
    case "zadd": { const z = zsets.get(key) ?? new Map(); let n = 0; for (let i = 1; i + 1 < a.length; i += 2) { if (!z.has(a[i + 1])) n++; z.set(a[i + 1], Number(a[i])); } zsets.set(key, z); return n; }
    case "zrange": { const z = zsets.get(key) ?? new Map(); const rows = [...z.entries()].sort((x, y) => x[1] - y[1]); return rows.map((r) => r[0]).slice(Number(a[1]), Number(a[2]) + 1); }
    case "keys": return glob(a[0]);
    case "scan": {
      let pattern = "*", count = 10;
      for (let i = 1; i < a.length; i++) { const o = a[i].toUpperCase(); if (o === "MATCH") pattern = a[++i]; else if (o === "COUNT") count = Number(a[++i]); }
      const ks = glob(pattern); const cur = Number(a[0]); const slice = ks.slice(cur, cur + count);
      return [String(cur + count >= ks.length ? 0 : cur + count), slice];
    }
    case "eval": {
      // The one script in src (proof-of-favour.ts): compare-and-delete a lock.
      const script = a[0]; const nkeys = Number(a[1]); const keys = a.slice(2, 2 + nkeys); const argv = a.slice(2 + nkeys);
      if (script.includes("redis.call('get', KEYS[1]) == ARGV[1]")) { sweep(keys[0]); if (strings.get(keys[0]) === argv[0]) return del(keys[0]); return 0; }
      throw new Error("ERR unsupported script in local-kv");
    }
    default: throw new Error(`ERR unknown command '${cmd}' (local-kv)`);
  }
}

const b64 = (v) => (typeof v === "string" ? (v === "OK" ? "OK" : Buffer.from(v).toString("base64")) : Array.isArray(v) ? v.map(b64) : v);

function execute(args, encode) {
  try {
    const result = run(args);
    return { result: encode ? b64(result) : result };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const encode = String(req.headers["upstash-encoding"] || "").toLowerCase() === "base64";
    let out;
    try {
      const parsed = body ? JSON.parse(body) : [];
      const path = (req.url || "/").split("?")[0];
      if (path === "/pipeline" || path === "/multi-exec") out = parsed.map((cmd) => execute(cmd, encode));
      else if (path === "/") out = execute(parsed, encode);
      else {
        // GET-style: /get/key etc. Not used by the client in src; answer plainly.
        out = execute(path.slice(1).split("/").map(decodeURIComponent), encode);
      }
    } catch (err) {
      out = { error: String(err?.message || err) };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[local-kv] in-memory Upstash stand-in on http://127.0.0.1:${PORT}. Test data only; nothing persists.`);
});
