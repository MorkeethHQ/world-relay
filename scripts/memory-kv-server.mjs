#!/usr/bin/env node
/**
 * Local Upstash-REST-compatible memory KV for cold labelled journeys.
 * No network dependency beyond localhost. One command:
 *   node scripts/memory-kv-server.mjs
 * Then:
 *   KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=local npm run dev
 *
 * Speaks enough of the Upstash REST surface for @upstash/redis used by this app:
 * POST /  with JSON ["CMD", ...]
 * POST /pipeline with JSON [["CMD",...], ...]
 */
import http from "node:http";

const PORT = Number(process.env.MEMORY_KV_PORT || 8079);
const TOKEN = process.env.MEMORY_KV_TOKEN || "local";

const kv = new Map();
const sets = new Map();
const lists = new Map();
const hashes = new Map();
const sortedSets = new Map();

function ensureSet(key) {
  if (!sets.has(key)) sets.set(key, new Set());
  return sets.get(key);
}
function ensureList(key) {
  if (!lists.has(key)) lists.set(key, []);
  return lists.get(key);
}
function ensureHash(key) {
  if (!hashes.has(key)) hashes.set(key, new Map());
  return hashes.get(key);
}

function runCommand(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return { error: "empty command" };
  }
  const cmd = String(parts[0]).toUpperCase();
  const args = parts.slice(1).map(String);

  switch (cmd) {
    case "SET": {
      const key = args[0];
      let i = 2;
      let nx = false;
      let px = null;
      while (i < args.length) {
        const opt = args[i].toUpperCase();
        if (opt === "NX") {
          nx = true;
          i += 1;
        } else if (opt === "PX") {
          px = Number(args[i + 1]);
          i += 2;
        } else if (opt === "EX") {
          px = Number(args[i + 1]) * 1000;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (nx && kv.has(key)) return { result: null };
      kv.set(key, args[1]);
      if (px && Number.isFinite(px)) {
        setTimeout(() => kv.delete(key), px).unref?.();
      }
      return { result: "OK" };
    }
    case "GET":
      return { result: kv.has(args[0]) ? kv.get(args[0]) : null };
    case "DEL": {
      let n = 0;
      for (const k of args) {
        if (kv.delete(k)) n += 1;
        if (sets.delete(k)) n += 1;
        if (lists.delete(k)) n += 1;
        if (hashes.delete(k)) n += 1;
        if (sortedSets.delete(k)) n += 1;
      }
      return { result: n };
    }
    case "SADD": {
      const s = ensureSet(args[0]);
      let added = 0;
      for (const m of args.slice(1)) {
        if (!s.has(m)) {
          s.add(m);
          added += 1;
        }
      }
      return { result: added };
    }
    case "SMEMBERS":
      return { result: Array.from(ensureSet(args[0])) };
    case "SISMEMBER":
      return { result: ensureSet(args[0]).has(args[1]) ? 1 : 0 };
    case "SREM": {
      const s = ensureSet(args[0]);
      let n = 0;
      for (const m of args.slice(1)) {
        if (s.delete(m)) n += 1;
      }
      return { result: n };
    }
    case "SCARD":
      return { result: ensureSet(args[0]).size };
    case "LPUSH": {
      const list = ensureList(args[0]);
      for (const v of args.slice(1).reverse()) list.unshift(v);
      return { result: list.length };
    }
    case "RPUSH": {
      const list = ensureList(args[0]);
      list.push(...args.slice(1));
      return { result: list.length };
    }
    case "LRANGE": {
      const list = ensureList(args[0]);
      const start = Number(args[1]);
      let stop = Number(args[2]);
      if (stop < 0) stop = list.length + stop;
      return { result: list.slice(start, stop + 1) };
    }
    case "LTRIM": {
      const list = ensureList(args[0]);
      const start = Number(args[1]);
      let stop = Number(args[2]);
      if (stop < 0) stop = list.length + stop;
      lists.set(args[0], list.slice(start, stop + 1));
      return { result: "OK" };
    }
    case "INCR": {
      const cur = Number(kv.get(args[0]) || 0) + 1;
      kv.set(args[0], String(cur));
      return { result: cur };
    }
    case "EXPIRE":
    case "PEXPIRE":
      return { result: 1 };
    case "HINCRBY": {
      const h = ensureHash(args[0]);
      const field = args[1];
      const by = Number(args[2]);
      const next = Number(h.get(field) || 0) + by;
      h.set(field, String(next));
      return { result: next };
    }
    case "HGET": {
      const h = ensureHash(args[0]);
      return { result: h.has(args[1]) ? h.get(args[1]) : null };
    }
    case "HSET": {
      const h = ensureHash(args[0]);
      for (let i = 1; i < args.length; i += 2) {
        h.set(args[i], args[i + 1]);
      }
      return { result: 1 };
    }
    case "ZINCRBY": {
      const key = args[0];
      const by = Number(args[1]);
      const member = args[2];
      if (!sortedSets.has(key)) sortedSets.set(key, new Map());
      const zset = sortedSets.get(key);
      const next = Number(zset.get(member) || 0) + by;
      zset.set(member, next);
      return { result: String(next) };
    }
    case "EVAL": {
      // The app uses EVAL only for compare-token lock release.
      const keyCount = Number(args[1]);
      const key = keyCount > 0 ? args[2] : null;
      const token = args[2 + keyCount];
      if (key && kv.get(key) === token) {
        kv.delete(key);
        return { result: 1 };
      }
      return { result: 0 };
    }
    case "PING":
      return { result: "PONG" };
    default:
      return { error: `ERR unknown command '${cmd}'` };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "[]";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function authOk(req) {
  const h = req.headers.authorization || "";
  if (h === `Bearer ${TOKEN}`) return true;
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  return url.searchParams.get("_token") === TOKEN;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!authOk(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const body = req.method === "POST" ? await readBody(req) : [];
    if (url.pathname === "/pipeline" || url.pathname === "/multi-exec") {
      const results = (Array.isArray(body) ? body : []).map(runCommand);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
      return;
    }
    // Single command: body is ["CMD", ...] OR path segments /CMD/arg/...
    let parts = body;
    if (!Array.isArray(parts) || parts.length === 0) {
      const segs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      parts = segs;
    }
    const out = runCommand(parts);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`memory-kv listening on http://127.0.0.1:${PORT} (token=${TOKEN})`);
});
