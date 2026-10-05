import { createHash } from "crypto";
// An in-memory stand-in for the store client, for tests that run real routes
// and real lib code end to end. It is a double, not Redis: it holds the commands
// these tests reach and throws on any other, so a missing command is loud.
export function createMemoryRedis() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const parse = (v: string | undefined) => {
    if (v === undefined) return null;
    try { return JSON.parse(v); } catch { return v; }
  };
  const client = {
    get: async (k: string) => parse(kv.get(k)),
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && kv.has(k)) return null;
      kv.set(k, str(v));
      return "OK";
    },
    del: async (...ks: string[]) => { let n = 0; for (const k of ks) { if (kv.delete(k)) n++; sets.delete(k); lists.delete(k); hashes.delete(k); } return n; },
    exists: async (k: string) => (kv.has(k) || sets.has(k) || lists.has(k) || hashes.has(k) ? 1 : 0),
    incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; },
    incrby: async (k: string, by: number) => { const n = Number(kv.get(k) ?? 0) + by; kv.set(k, String(n)); return n; },
    decr: async (k: string) => { const n = Number(kv.get(k) ?? 0) - 1; kv.set(k, String(n)); return n; },
    expire: async () => 1,
    pexpire: async () => 1,
    keys: async (pattern: string) => { const p = pattern.replace(/\*$/, ""); return [...kv.keys()].filter((k) => k.startsWith(p)); },
    sadd: async (k: string, ...ms: string[]) => { if (!sets.has(k)) sets.set(k, new Set()); let n = 0; for (const m of ms) { if (!sets.get(k)!.has(str(m))) n++; sets.get(k)!.add(str(m)); } return n; },
    srem: async (k: string, ...ms: string[]) => { let n = 0; for (const m of ms) if (sets.get(k)?.delete(str(m))) n++; return n; },
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
    sismember: async (k: string, m: string) => (sets.get(k)?.has(str(m)) ? 1 : 0),
    scard: async (k: string) => sets.get(k)?.size ?? 0,
    lpush: async (k: string, ...vs: unknown[]) => { if (!lists.has(k)) lists.set(k, []); for (const v of vs) lists.get(k)!.unshift(str(v)); return lists.get(k)!.length; },
    rpush: async (k: string, ...vs: unknown[]) => { if (!lists.has(k)) lists.set(k, []); for (const v of vs) lists.get(k)!.push(str(v)); return lists.get(k)!.length; },
    ltrim: async (k: string, a: number, b: number) => { const l = lists.get(k); if (l) lists.set(k, l.slice(a, b < 0 ? undefined : b + 1)); return "OK"; },
    lrange: async (k: string, a: number, b: number) => (lists.get(k) ?? []).slice(a, b < 0 ? undefined : b + 1).map((v) => parse(v)),
    hgetall: async (k: string) => { const h = hashes.get(k); return h && h.size ? Object.fromEntries(h) : null; },
    hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
    hset: async (k: string, obj: Record<string, unknown>) => { if (!hashes.has(k)) hashes.set(k, new Map()); for (const [f, v] of Object.entries(obj)) hashes.get(k)!.set(f, String(v)); return 1; },
    hincrby: async (k: string, f: string, by: number) => { if (!hashes.has(k)) hashes.set(k, new Map()); const n = Number(hashes.get(k)!.get(f) ?? 0) + by; hashes.get(k)!.set(f, String(n)); return n; },
    zincrby: async (k: string, by: number, m: string) => { if (!zsets.has(k)) zsets.set(k, new Map()); const n = (zsets.get(k)!.get(m) ?? 0) + by; zsets.get(k)!.set(m, n); return n; },
    pipeline: () => {
      const ops: Array<() => unknown> = [];
      const p = { get: (k: string) => { ops.push(() => parse(kv.get(k))); return p; }, exec: async () => ops.map((op) => op()) };
      return p;
    },
    // The token-checked lock release used across the repo, and nothing else.
    eval: async (script: string, keys: string[], args: unknown[]) => {
      if (/redis\.call\('get', KEYS\[1\]\) == ARGV\[1\]/i.test(script)) {
        if (kv.get(keys[0]) === String(args[0])) { kv.delete(keys[0]); return 1; }
        return 0;
      }
      // The read-with-hash script (src/lib/redis-snapshot.ts).
      if (script.includes("redis.sha1hex(v)") && script.includes("redis.call('GET', KEYS[1])")) {
        const v = kv.get(keys[0]);
        return v === undefined ? ["", ""] : [v, createHash("sha1").update(v).digest("hex")];
      }
      // The three review scripts, repeated here in JavaScript. Their real Lua is
      // checked on a real Redis by sol-house-review.real-redis.test.ts.
      if (script.startsWith("-- favour:case-slot")) {
        const mine = kv.get(keys[1]);
        if (mine !== undefined) return mine;
        if (!sets.has(keys[0])) sets.set(keys[0], new Set());
        const had = sets.get(keys[0])!.has(String(args[0]));
        sets.get(keys[0])!.add(String(args[0]));
        const result = had ? "none" : "credit";
        kv.set(keys[1], result);
        return result;
      }
      if (script.startsWith("-- favour:case-history")) {
        if (kv.has(keys[0])) return 0;
        kv.set(keys[0], String(args[0]));
        if (!lists.has(keys[1])) lists.set(keys[1], []);
        lists.get(keys[1])!.unshift(String(args[1]));
        lists.set(keys[1], lists.get(keys[1])!.slice(0, Number(args[2])));
        return 1;
      }
      if (script.startsWith("-- favour:keyed-credit")) {
        if (kv.get(keys[3]) !== String(args[4])) return "lock";
        const raw = kv.get(keys[0]);
        const hash = raw === undefined ? "" : createHash("sha1").update(raw).digest("hex");
        if (hash !== String(args[0])) return "changed";
        kv.set(keys[0], String(args[1]));
        if (!sets.has(keys[1])) sets.set(keys[1], new Set());
        sets.get(keys[1])!.add(String(args[2]));
        if (!zsets.has(keys[2])) zsets.set(keys[2], new Map());
        zsets.get(keys[2])!.set(String(args[2]), (zsets.get(keys[2])!.get(String(args[2])) ?? 0) + Number(args[3]));
        return "ok";
      }
      throw new Error("memory-redis: unknown EVAL script");
    },
  };
  return { client, kv, sets, lists, hashes, zsets, raw: (k: string) => kv.get(k) };
}
