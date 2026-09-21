import { describe, it, expect, beforeEach, vi } from "vitest";

// REAL OR NOT, PLAYABLE FOREVER (Oscar, 2026-09-21). When a judge has ruled on
// every live proof, the deck is dealt again from the same REAL, verified proofs as
// a practice round. Nothing is generated. Practice is graded but pays nothing, uses
// none of the daily cap, and leaves the judge's stats alone, so it cannot be farmed.

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
vi.mock("@/lib/proof-of-favour", () => ({ awardPoints: async (...a: any[]) => { awarded.push(a); } }));

import { issueJuryDeckWithMode, recordJuryVerdict, getCardAnswer } from "@/lib/jury";

const JUDGE = "0xcccccccccccccccccccccccccccccccccccccccc";
function proof(id: string, desc: string) {
  return { id, status: "completed", proofImageUrl: `/p/${id}.jpg`, proofNote: null, description: desc, category: "photo", location: "Anywhere",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222",
    verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } } as any;
}
const TASKS = [proof("a", "a queue at a bakery"), proof("b", "a bus timetable"), proof("c", "a shelf of milk"), proof("d", "a sunset")];
let n = 0;
const rid = () => `card-${++n}`;

beforeEach(() => { kv.clear(); sets.clear(); hashes.clear(); awarded.length = 0; n = 0; });

async function judgeAll(cards: { cardId: string }[]) {
  const out = [];
  for (const c of cards) out.push(await recordJuryVerdict(JUDGE, c.cardId, true));
  return out;
}

describe("the live deck pays as before", () => {
  it("a live round is not practice and a correct call earns a point", async () => {
    const { cards, practice } = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    expect(practice).toBe(false);
    expect(cards.length).toBeGreaterThan(0);
    const results = await judgeAll(cards);
    expect(results.some((r: any) => r.pointsAwarded === 1)).toBe(true);
  });
});

describe("after every live proof is judged, the game keeps going on real proofs", () => {
  it("the next deck is a practice round of the SAME real proofs, never empty", async () => {
    const live = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    await judgeAll(live.cards);
    const next = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    expect(next.practice).toBe(true);
    expect(next.cards.length).toBeGreaterThan(0);
    // Every practice card that is not a labelled AI-made decoy shows a real proof
    // from the pool. Decoys (lib/decoys.ts, 2026-09-21) are the only invented cards,
    // and they are marked server-side and revealed after the call.
    const realDescs = new Set(TASKS.map((t) => t.description));
    for (const c of next.cards) {
      const a = await getCardAnswer(c.cardId);
      if (!a?.decoy) expect(realDescs.has(c.description)).toBe(true);
    }
    // And a third deck still deals: playable for ever.
    const third = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    expect(third.practice).toBe(true);
    expect(third.cards.length).toBeGreaterThan(0);
  });

  it("practice pays nothing, uses none of the daily cap, and leaves stats alone", async () => {
    const live = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    await judgeAll(live.cards);
    const paidBefore = awarded.length;
    const stats = { ...Object.fromEntries(hashes.get(`jury:stats:${JUDGE}`) ?? []) };
    const capKey = [...kv.keys()].find((k) => k.startsWith("jury:pts:"));
    const capBefore = capKey ? kv.get(capKey) : 0;

    const practice = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    for (let round = 0; round < 5; round++) {
      const deck = round === 0 ? practice : await issueJuryDeckWithMode(TASKS, JUDGE, rid);
      const res = await judgeAll(deck.cards);
      for (const r of res as any[]) {
        expect(r.practice).toBe(true);
        expect(r.pointsAwarded).toBe(0);
      }
    }
    expect(awarded.length).toBe(paidBefore);
    expect(Object.fromEntries(hashes.get(`jury:stats:${JUDGE}`) ?? [])).toEqual(stats);
    expect(capKey ? kv.get(capKey) : 0).toBe(capBefore);
  });

  it("a practice card is still single-use", async () => {
    const live = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    await judgeAll(live.cards);
    const { cards } = await issueJuryDeckWithMode(TASKS, JUDGE, rid);
    await recordJuryVerdict(JUDGE, cards[0].cardId, true);
    expect(await recordJuryVerdict(JUDGE, cards[0].cardId, true)).toHaveProperty("error");
  });
});
