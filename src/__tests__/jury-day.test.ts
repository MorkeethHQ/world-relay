import { beforeEach, describe, expect, it, vi } from "vitest";

// THE DAILY COUNT AND THE STREAK OF THE JURY GAME (day bet, 14 Oct 2026).
// Both numbers are written by the server at verdict time. The screen draws
// them; it never counts by itself.

const kv = new Map<string, any>();
let failSetOnce = false;
const sets = new Map<string, Set<string>>();
const hashes = new Map<string, Map<string, number>>();
const fakeRedis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: any) => { if (failSetOnce) { failSetOnce = false; throw new Error("store blip"); } kv.set(k, v); return "OK"; },
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

import { JURY_DAILY_GOAL, getJuryDay, liveStreak, nextStreak, recordJuryDay, utcDay } from "@/lib/jury-day";
import { issueJuryDeckWithMode, recordJuryVerdict } from "@/lib/jury";

const JUDGE = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

beforeEach(() => { kv.clear(); sets.clear(); hashes.clear(); awarded.length = 0; failSetOnce = false; process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME = "1"; });

describe("nextStreak and liveStreak", () => {
  it("a first day is 1, the next day is 2, a missed day starts again at 1 and keeps the best", () => {
    let s = nextStreak({ last: null, current: 0, best: 0 }, "2026-10-10");
    expect(s).toEqual({ last: "2026-10-10", current: 1, best: 1 });
    s = nextStreak(s, "2026-10-11");
    expect(s).toEqual({ last: "2026-10-11", current: 2, best: 2 });
    expect(nextStreak(s, "2026-10-11")).toBe(s); // the same day changes nothing
    s = nextStreak(s, "2026-10-13");
    expect(s).toEqual({ last: "2026-10-13", current: 1, best: 2 });
  });
  it("crosses a month end", () => {
    expect(nextStreak({ last: "2026-10-31", current: 4, best: 4 }, "2026-11-01").current).toBe(5);
  });
  it("reads 0 once a whole day is missed, and stays alive through yesterday", () => {
    const s = { last: "2026-10-12", current: 3, best: 3 };
    expect(liveStreak(s, "2026-10-12")).toBe(3);
    expect(liveStreak(s, "2026-10-13")).toBe(3);
    expect(liveStreak(s, "2026-10-14")).toBe(0);
  });
});

describe("recordJuryDay over the store", () => {
  it("counts each verdict today and says the goal was reached on the tenth only", async () => {
    const seen = [];
    for (let i = 0; i < JURY_DAILY_GOAL + 1; i++) seen.push(await recordJuryDay(JUDGE, D("2026-10-14")));
    expect(seen.map((d) => d!.today)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seen.map((d) => d!.goalReachedNow).filter(Boolean)).toHaveLength(1);
    expect(seen[9]!.goalReachedNow).toBe(true);
    expect(seen[0]!.streak).toBe(1);
  });
  it("builds a streak across days and the read matches the write", async () => {
    await recordJuryDay(JUDGE, D("2026-10-12"));
    await recordJuryDay(JUDGE, D("2026-10-13"));
    const d = await recordJuryDay(JUDGE, D("2026-10-14"));
    expect(d).toMatchObject({ today: 1, streak: 3, best: 3 });
    expect(await getJuryDay(JUDGE, D("2026-10-14"))).toMatchObject({ today: 1, streak: 3, best: 3, goalReachedNow: false });
    expect(await getJuryDay(JUDGE, D("2026-10-16"))).toMatchObject({ today: 0, streak: 0, best: 3 });
  });
  it("utcDay is the UTC date", () => {
    expect(utcDay(Date.parse("2026-10-14T23:59:59Z"))).toBe("2026-10-14");
    expect(utcDay(Date.parse("2026-10-15T00:00:00Z"))).toBe("2026-10-15");
  });
});

describe("a verdict carries the day, and the points rule is unchanged", () => {
  const proof = (id: string, desc: string) => ({ id, status: "completed", proofImageUrl: `/p/${id}.jpg`, proofNote: null, description: desc, category: "photo", location: "x",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any;
  const TASKS = [proof("a", "a queue at a bakery"), proof("b", "a bus timetable"), proof("c", "a shelf of milk"), proof("d", "a sunset")];

  it("each accepted verdict moves today's count by one; a repeat on the same card moves nothing", async () => {
    let n = 0;
    const { cards } = await issueJuryDeckWithMode(TASKS, JUDGE, () => `card-${++n}`);
    const first: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
    expect(first.day).toMatchObject({ today: 1, goal: JURY_DAILY_GOAL, streak: 1 });
    const second: any = await recordJuryVerdict(JUDGE, cards[1].cardId, false);
    expect(second.day.today).toBe(2);
    const again: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
    expect(again.error).toBeTruthy();
    expect((await getJuryDay(JUDGE, Date.now()))!.today).toBe(2);
  });
  it("points per right call stay 1", async () => {
    let n = 0;
    const { cards } = await issueJuryDeckWithMode(TASKS, JUDGE, () => `card-${++n}`);
    for (const c of cards) await recordJuryVerdict(JUDGE, c.cardId, true);
    for (const a of awarded) expect(a[2]).toBe(1);
  });
});

// R2 finding 7, 14 Oct 2026: the INCR landed, the streak write failed, and no
// later verdict repaired it (today=2, streak=0).
describe("a failed streak write is repaired by the next verdict", () => {
  it("today=2 after a blip still reads the right streak", async () => {
    await recordJuryDay(JUDGE, D("2026-10-13"));
    failSetOnce = true;
    await recordJuryDay(JUDGE, D("2026-10-14")).catch(() => null);
    const d = await recordJuryDay(JUDGE, D("2026-10-14"));
    expect(d).toMatchObject({ today: 2, streak: 2, best: 2 });
  });
});

// R2 finding 1, 14 Oct 2026: two decks gave the same proof two card ids, and
// the second verdict on the same proof was graded again: 25 verdicts on one
// proof gave 25/25 and qualified the judge.
describe("one graded verdict per proof, however many cards carried it", () => {
  const p = (id: string, desc: string) => ({ id, status: "completed", proofImageUrl: `/p/${id}.jpg`, proofNote: null, description: desc, category: "photo", location: "x",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any;
  const POOL = [p("a", "a queue at a bakery"), p("b", "a bus timetable"), p("c", "a shelf of milk"), p("d", "a sunset")];

  it("a second card on a judged proof moves no graded stat, no point and no day count", async () => {
    let n = 0;
    const deck1 = await issueJuryDeckWithMode(POOL, JUDGE, () => `x-${++n}`);
    const deck2 = await issueJuryDeckWithMode(POOL, JUDGE, () => `y-${++n}`);
    const { getCardAnswer } = await import("@/lib/jury");
    const real = async (cards: { cardId: string }[]) => {
      const out: { cardId: string; proof: string; isMatch: boolean }[] = [];
      for (const c of cards) { const a = await getCardAnswer(c.cardId); if (a && !a.decoy) out.push({ cardId: c.cardId, proof: a.proofTaskId, isMatch: a.isMatch }); }
      return out;
    };
    const one = await real(deck1.cards), two = await real(deck2.cards);
    const shared = one.find((c) => two.some((d) => d.proof === c.proof));
    expect(shared).toBeTruthy(); // both decks carry the same proof: the attack needs this
    const twin = two.find((d) => d.proof === shared!.proof)!;
    await recordJuryVerdict(JUDGE, shared!.cardId, shared!.isMatch);
    const before = { judged: hashes.get(`jury:stats:${JUDGE}`)?.get("judged"), points: awarded.length, today: (await getJuryDay(JUDGE, Date.now()))!.today };
    const again: any = await recordJuryVerdict(JUDGE, twin.cardId, twin.isMatch);
    expect(again.pointsAwarded ?? 0).toBe(0);
    expect(hashes.get(`jury:stats:${JUDGE}`)?.get("judged")).toBe(before.judged);
    expect(awarded.length).toBe(before.points);
    expect((await getJuryDay(JUDGE, Date.now()))!.today).toBe(before.today);
  });
});

// R2 finding 6, 14 Oct 2026: with the switch unset, the server still wrote and
// served the day count and streak.
describe("with the switch unset the server keeps no day count", () => {
  it("a verdict carries no day and writes no jury:day or jury:streak key", async () => {
    delete process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME;
    let n = 0;
    const pool = ["a queue at a bakery", "a bus timetable", "a shelf of milk", "a sunset"].map((d, i) => ({ id: `q${i}`, status: "completed", proofImageUrl: `/p/q${i}.jpg`, proofNote: null, description: d, category: "photo", location: "x",
      claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any);
    const { cards } = await issueJuryDeckWithMode(pool, JUDGE, () => `z-${++n}`);
    expect(cards.length).toBeGreaterThan(0);
    const r: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
    expect(r.day ?? null).toBeNull();
    expect([...kv.keys()].filter((k) => k.startsWith("jury:day:") || k.startsWith("jury:streak:"))).toEqual([]);
  });
});

describe("the record route asks the same switch (source read)", () => {
  it("reads the day only when juryGameOn()", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(`${process.cwd()}/src/app/api/jury/record/route.ts`, "utf8")).toMatch(/judge && juryGameOn\(\) \? await getJuryDay/);
  });
});
