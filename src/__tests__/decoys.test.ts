import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// AI-MADE DECOYS live in Real or Not and nowhere else (2026-09-21, Oscar's call).
// These tests go red if a decoy can reach any public list or count, or be paid as a
// completion.

const kv = new Map<string, any>();
const sets = new Map<string, Set<string>>();
const hashes = new Map<string, Map<string, number>>();
const fakeRedis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: any) => { kv.set(k, v); return "OK"; },
  del: async (k: string) => (kv.delete(k) ? 1 : 0),
  incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, n); return n; },
  expire: async () => 1,
  sadd: async (k: string, m: string) => { const s = sets.get(k) ?? new Set(); const had = s.has(m); s.add(m); sets.set(k, s); return had ? 0 : 1; },
  smembers: async (k: string) => [...(sets.get(k) ?? [])],
  hincrby: async (k: string, f: string, n: number) => { const h = hashes.get(k) ?? new Map(); h.set(f, (h.get(f) ?? 0) + n); hashes.set(k, h); return h.get(f); },
  hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
};
vi.mock("@/lib/redis", () => ({ getRedis: () => fakeRedis }));
const awarded: any[] = [];
vi.mock("@/lib/proof-of-favour", async (orig) => ({ ...(await (orig() as Promise<any>)), awardPoints: async (...a: any[]) => { awarded.push(a); } }));

import { DECOYS, DECOY_SOURCE } from "@/lib/decoys";
import { issueJuryDeckWithMode, recordJuryVerdict, getCardAnswer } from "@/lib/jury";
import { pickProofStrip, pickDailyMission } from "@/lib/board-rank";

const JUDGE = "0xcccccccccccccccccccccccccccccccccccccccc";
function proof(id: string, desc: string) {
  return { id, status: "completed", proofImageUrl: `/p/${id}.jpg`, proofNote: null, description: desc, category: "photo", location: "Anywhere",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222",
    verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" }, deadline: new Date(Date.now() + 864e5).toISOString(), rewardType: "points", bountyUsdc: 5 } as any;
}
const TASKS = Array.from({ length: 8 }, (_, i) => proof(`t${i}`, `a real favour number ${i} about a place`));
let n = 0; const rid = () => `card-${++n}`;
beforeEach(() => { kv.clear(); sets.clear(); hashes.clear(); awarded.length = 0; n = 0; });

describe("the decoy set itself", () => {
  it("is a couple: 6 to 10, each labelled with its source", () => {
    expect(DECOYS.length).toBeGreaterThanOrEqual(6);
    expect(DECOYS.length).toBeLessThanOrEqual(10);
    for (const d of DECOYS) expect(d.source).toBe(DECOY_SOURCE);
  });
  it("borrows no real person: no wallet, no handle, no photo", () => {
    for (const d of DECOYS) {
      const text = `${d.description} ${d.proofNote}`;
      expect(text).not.toMatch(/0x[0-9a-fA-F]{6,}/);
      expect(text).not.toMatch(/@\w/);
      expect(d).not.toHaveProperty("proofImageUrl");
      expect(d).not.toHaveProperty("poster");
      expect(d).not.toHaveProperty("claimant");
    }
  });
});

describe("decoys appear only inside Real or Not, and only as ordinary-looking cards", () => {
  it("a live deck mixes in at most two decoys, never at the cost of real cards", async () => {
    const { cards, practice, waiting } = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    expect(practice).toBe(false);
    const answers = await Promise.all(cards.map((c) => getCardAnswer(c.cardId)));
    const decoys = answers.filter((a) => a?.decoy);
    expect(decoys.length).toBeGreaterThan(0);
    expect(decoys.length).toBeLessThanOrEqual(2);
    expect(answers.filter((a) => !a?.decoy).length).toBeGreaterThan(0);
    // The server's "waiting" counts real proofs only.
    expect(waiting).toBe(TASKS.length);
  });

  it("the client body carries nothing that marks a decoy before the call", async () => {
    const { cards } = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    const body = JSON.stringify(cards);
    expect(body).not.toMatch(/decoy/i);
    expect(body).not.toContain(DECOY_SOURCE);
  });

  it("a deck is never decoys alone", async () => {
    const { cards } = await issueJuryDeckWithMode([], JUDGE, rid);
    expect(cards).toHaveLength(0);
    const one = await issueJuryDeckWithMode([TASKS[0]], JUDGE, rid);
    expect(one.cards).toHaveLength(0);
  });

  it("the public board helpers are built from tasks, so a decoy cannot be in them", () => {
    const ids = new Set(DECOYS.map((d) => d.id));
    for (const t of pickProofStrip(TASKS)) expect(ids.has(t.id)).toBe(false);
    const m = pickDailyMission(TASKS, "2026-09-21", null);
    expect(m ? ids.has(m.id) : false).toBe(false);
  });

  it("only lib/jury.ts imports the decoys, so no feed, History, stats, strip or campaign code can", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f)) continue;
        if (/from ["']@\/lib\/decoys["']|from ["']\.\/decoys["']/.test(readFileSync(p, "utf8"))) hits.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(hits).toEqual(["lib/jury.ts"]);
  });
});

describe("a decoy scores like a real card and can never be paid as a completion", () => {
  it("calling a decoy Not is correct and pays one point under the daily cap; calling it real is wrong", async () => {
    const { cards } = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    const answers = await Promise.all(cards.map(async (c) => ({ c, a: await getCardAnswer(c.cardId) })));
    const [d1, d2] = answers.filter((x) => x.a?.decoy);
    const right = await recordJuryVerdict(JUDGE, d1.c.cardId, false) as any;
    expect(right).toMatchObject({ correct: true, pointsAwarded: 1, decoy: true });
    if (d2) {
      const wrong = await recordJuryVerdict(JUDGE, d2.c.cardId, true) as any;
      expect(wrong).toMatchObject({ correct: false, pointsAwarded: 0, decoy: true });
    }
  });

  it("a judged decoy is not dealt again in a live round", async () => {
    const first = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    const decoyCards = [];
    for (const c of first.cards) { const a = await getCardAnswer(c.cardId); if (a?.decoy) decoyCards.push({ c, id: a.proofTaskId }); }
    for (const d of decoyCards) await recordJuryVerdict(JUDGE, d.c.cardId, false);
    const second = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    for (const c of second.cards) {
      const a = await getCardAnswer(c.cardId);
      if (a?.decoy) expect(decoyCards.map((d) => d.id)).not.toContain(a.proofTaskId);
    }
  });

  it("in a practice round a decoy pays nothing", async () => {
    const live = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    for (const c of live.cards) await recordJuryVerdict(JUDGE, c.cardId, false);
    const practice = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    expect(practice.practice).toBe(true);
    for (const c of practice.cards) {
      const a = await getCardAnswer(c.cardId);
      const r = await recordJuryVerdict(JUDGE, c.cardId, false) as any;
      expect(r.pointsAwarded).toBe(0);
      if (a?.decoy) expect(r.decoy).toBe(true);
    }
  });
});
