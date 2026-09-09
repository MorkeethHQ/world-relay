// A local, in-process stand-in for the Upstash Redis client.
//
// Why this exists (2026-09-08, F1): the store is Redis-only. Without KV
// credentials `listTasks` returns [] and `persistTask` is a no-op, so the app
// runs but the board is permanently empty and nothing can be demonstrated end
// to end. The only way to see the loop work was to point a local dev server at
// the PRODUCTION store and write real records into it. That is the wrong trade,
// and this file removes the need to make it.
//
// It is deliberately narrow and deliberately hard to switch on:
//   - it is returned by getRedis() ONLY when FAVOUR_MEMORY_STORE=1 AND no KV
//     credentials are set,
//   - it throws if NODE_ENV is production, so it can never back a deployment,
//   - it holds everything in one process and forgets it on restart.
//
// It implements the commands the task/board path actually uses. Anything else
// is not silently faked: an unimplemented command throws, so a caller finds out
// rather than reading a wrong empty answer back.

type Entry = { value: unknown; expiresAt: number | null };

function now(): number {
  return Date.now();
}

export class MemoryRedis {
  private data = new Map<string, Entry>();

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private setRaw(key: string, value: unknown, expiresAt: number | null = null) {
    this.data.set(key, { value, expiresAt });
  }

  private setOf(key: string): Set<string> {
    const e = this.live(key);
    if (e && e.value instanceof Set) return e.value as Set<string>;
    const s = new Set<string>();
    this.setRaw(key, s);
    return s;
  }

  private hashOf(key: string): Map<string, unknown> {
    const e = this.live(key);
    if (e && e.value instanceof Map) return e.value as Map<string, unknown>;
    const m = new Map<string, unknown>();
    this.setRaw(key, m);
    return m;
  }

  private listOf(key: string): unknown[] {
    const e = this.live(key);
    if (e && Array.isArray(e.value)) return e.value as unknown[];
    const l: unknown[] = [];
    this.setRaw(key, l);
    return l;
  }

  private sortedSetOf(key: string): Map<string, number> {
    const e = this.live(key);
    if (e && e.value instanceof Map) return e.value as Map<string, number>;
    const z = new Map<string, number>();
    this.setRaw(key, z);
    return z;
  }

  // --- strings ---
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number; px?: number }) {
    if (opts?.nx && this.live(key)) return null;
    const ttl = opts?.ex ? opts.ex * 1000 : opts?.px ? opts.px : null;
    this.setRaw(key, value, ttl === null ? null : now() + ttl);
    return "OK";
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }

  async exists(...keys: string[]) {
    return keys.filter((k) => !!this.live(k)).length;
  }

  async keys(pattern: string) {
    const rx = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return [...this.data.keys()].filter((k) => !!this.live(k) && rx.test(k));
  }

  async expire(key: string, seconds: number) {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = now() + seconds * 1000;
    return 1;
  }

  async pexpire(key: string, ms: number) {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = now() + ms;
    return 1;
  }

  private async addNumber(key: string, by: number) {
    const cur = Number(this.live(key)?.value ?? 0);
    const next = (Number.isFinite(cur) ? cur : 0) + by;
    this.setRaw(key, next, this.live(key)?.expiresAt ?? null);
    return next;
  }

  async incr(key: string) {
    return this.addNumber(key, 1);
  }

  async incrby(key: string, by: number) {
    return this.addNumber(key, by);
  }

  async decr(key: string) {
    return this.addNumber(key, -1);
  }

  // --- sets ---
  async sadd(key: string, ...members: string[]) {
    const s = this.setOf(key);
    let n = 0;
    for (const m of members.flat()) if (!s.has(String(m))) { s.add(String(m)); n++; }
    return n;
  }

  async srem(key: string, ...members: string[]) {
    const s = this.setOf(key);
    let n = 0;
    for (const m of members.flat()) if (s.delete(String(m))) n++;
    return n;
  }

  async smembers(key: string) {
    return [...this.setOf(key)];
  }

  async scard(key: string) {
    return this.setOf(key).size;
  }

  async sismember(key: string, member: string) {
    return this.setOf(key).has(String(member)) ? 1 : 0;
  }

  async sinter(...keys: string[]) {
    const sets = keys.map((k) => this.setOf(k));
    if (sets.length === 0) return [];
    return [...sets[0]].filter((m) => sets.every((s) => s.has(m)));
  }

  // --- hashes ---
  async hset(key: string, field: Record<string, unknown>) {
    const h = this.hashOf(key);
    for (const [f, v] of Object.entries(field)) h.set(f, v);
    return Object.keys(field).length;
  }

  async hsetnx(key: string, field: string, value: unknown) {
    const h = this.hashOf(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    return 1;
  }

  async hget(key: string, field: string) {
    return this.hashOf(key).get(field) ?? null;
  }

  async hgetall(key: string) {
    const h = this.hashOf(key);
    if (h.size === 0) return null;
    return Object.fromEntries(h);
  }

  async hkeys(key: string) {
    return [...this.hashOf(key).keys()];
  }

  async hdel(key: string, ...fields: string[]) {
    const h = this.hashOf(key);
    let n = 0;
    for (const f of fields.flat()) if (h.delete(f)) n++;
    return n;
  }

  async hincrby(key: string, field: string, by: number) {
    const h = this.hashOf(key);
    const next = Number(h.get(field) ?? 0) + by;
    h.set(field, next);
    return next;
  }

  // --- lists ---
  async lpush(key: string, ...values: unknown[]) {
    const l = this.listOf(key);
    l.unshift(...values.flat());
    return l.length;
  }

  async rpush(key: string, ...values: unknown[]) {
    const l = this.listOf(key);
    l.push(...values.flat());
    return l.length;
  }

  async lrange(key: string, start: number, stop: number) {
    const l = this.listOf(key);
    const end = stop < 0 ? l.length + stop + 1 : stop + 1;
    return l.slice(start < 0 ? l.length + start : start, end);
  }

  async ltrim(key: string, start: number, stop: number) {
    const l = this.listOf(key);
    const end = stop < 0 ? l.length + stop + 1 : stop + 1;
    const kept = l.slice(start < 0 ? l.length + start : start, end);
    this.setRaw(key, kept);
    return "OK";
  }

  async lset(key: string, index: number, value: unknown) {
    const l = this.listOf(key);
    l[index < 0 ? l.length + index : index] = value;
    return "OK";
  }

  // --- pipeline (the store uses get-only pipelines) ---
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    const api = {
      get(key: string) { ops.push(() => self.get(key)); return api; },
      set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) { ops.push(() => self.set(key, value, opts)); return api; },
      sadd(key: string, ...m: string[]) { ops.push(() => self.sadd(key, ...m)); return api; },
      srem(key: string, ...m: string[]) { ops.push(() => self.srem(key, ...m)); return api; },
      del(...k: string[]) { ops.push(() => self.del(...k)); return api; },
      async exec() {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return api;
  }

  // Exact compare-and-delete shape used by the points write lock. Any other
  // script still fails loudly rather than pretending to be Redis.
  async eval(_script: string, keys: string[], args: string[]) {
    if (keys.length !== 1 || args.length !== 1) throw new Error("MemoryRedis: eval shape is not implemented");
    if (await this.get(keys[0]) !== args[0]) return 0;
    return this.del(keys[0]);
  }

  async call(): Promise<never> {
    throw new Error("MemoryRedis: call is not implemented");
  }

  async scan(): Promise<never> {
    throw new Error("MemoryRedis: scan is not implemented");
  }

  async zincrby(key: string, increment: number, member: string) {
    const z = this.sortedSetOf(key);
    const next = (z.get(member) ?? 0) + increment;
    z.set(member, next);
    return next;
  }
}

// True only when the local memory store is explicitly asked for AND there is no
// real KV to talk to. Both conditions are required, so a machine that has
// production credentials in its environment can never silently drop into it.
export function memoryStoreRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FAVOUR_MEMORY_STORE !== "1") return false;
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return false;
  return true;
}

// Deterministic browser journeys may ask the isolated store to accept proof.
// Three conditions make this impossible against production or real KV.
export function deterministicLocalProofEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.FAVOUR_LOCAL_PROOF_PASS === "1" && memoryStoreRequested(env);
}

// A deterministic journey needs to drive a REJECTION as well as an acceptance,
// because "a rejected proof is never shown as rewarded" is only provable if a
// rejection can be produced on demand. The verdict is chosen by a sentinel in
// the proof note, and it lives behind exactly the same three conditions as
// deterministicLocalProofEnabled: never production, never real KV, and only
// when the isolated store was explicitly asked for. A caller that cannot reach
// the isolated store cannot reach this.
export const LOCAL_REJECT_SENTINEL = "[[LOCAL-REJECT]]";

export function deterministicLocalProofVerdict(proofNote: string | null | undefined): "pass" | "fail" {
  return (proofNote || "").includes(LOCAL_REJECT_SENTINEL) ? "fail" : "pass";
}

// Next compiles route handlers and server pages as separate module graphs in
// development. A module-local singleton made POST /api/campaigns succeed while
// /c/[id] read a different empty store and returned 404. Global scope is still
// process-local and is the correct boundary for this explicitly local store.
const memoryGlobal = globalThis as typeof globalThis & { __favourMemoryRedis?: MemoryRedis };

export function getMemoryRedis(env: NodeJS.ProcessEnv = process.env): MemoryRedis {
  if (env.NODE_ENV === "production") {
    throw new Error("MemoryRedis must never back a production deployment");
  }
  if (!memoryGlobal.__favourMemoryRedis) memoryGlobal.__favourMemoryRedis = new MemoryRedis();
  return memoryGlobal.__favourMemoryRedis;
}
