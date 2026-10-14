import { beforeEach, describe, expect, it, vi } from "vitest";

// THE DAILY COUNT AND THE STREAK OF THE JURY GAME (day bet, 14 Oct 2026).
// Both numbers are written by the server at verdict time. The screen draws
// them; it never counts by itself.

const kv = new Map<string, any>();
let failTxOnce = false;
let loseReplyOnce = false; // the transaction runs, then its reply is lost
const fields = new Map<string, Map<string, string>>();
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
  sismember: async (k: string, m: string) => (sets.get(k)?.has(m) ? 1 : 0),
  scard: async (k: string) => sets.get(k)?.size ?? 0,
  hsetnx: async (k: string, f: string, v: string) => { const h = fields.get(k) ?? new Map(); if (h.has(f)) return 0; h.set(f, v); fields.set(k, h); return 1; },
  hincrby: async (k: string, f: string, n: number) => { const h = hashes.get(k) ?? new Map(); h.set(f, (h.get(f) ?? 0) + n); hashes.set(k, h); return h.get(f); },
  hget: async (k: string, f: string) => fields.get(k)?.get(f) ?? hashes.get(k)?.get(f) ?? null,
  // The day script (lib/jury-day.ts RECORD_JURY_DAY), repeated in JavaScript.
  // It runs whole, or (with failTxOnce) not at all; loseReplyOnce runs it and loses the reply.
  eval: async (script: string, keys: string[], args: any[]) => {
    if (!script.startsWith("-- favour:jury-day")) throw new Error("unknown script");
    if (failTxOnce) { failTxOnce = false; throw new Error("store blip"); }
    const [dayOf, days, todayKey] = keys; const [member, day, prefix] = args.map(String);
    const h = fields.get(dayOf) ?? new Map(); fields.set(dayOf, h);
    if (!h.has(member)) h.set(member, day);
    const counted = h.get(member)!;
    const added = await fakeRedis.sadd(prefix + counted, member);
    await fakeRedis.sadd(days, counted);
    const out = [added, await fakeRedis.scard(todayKey), counted, await fakeRedis.smembers(days)];
    if (loseReplyOnce) { loseReplyOnce = false; throw new Error("reply lost"); }
    return out;
  },
  // A transaction: every queued command runs, or (with failTxOnce) none does.
  multi: () => {
    const ops: (() => Promise<unknown>)[] = [];
    const tx: any = {
      incr: (k: string) => { ops.push(() => fakeRedis.incr(k)); return tx; },
      expire: (k: string) => { ops.push(() => fakeRedis.expire()); return tx; },
      sadd: (k: string, m: string) => { ops.push(() => fakeRedis.sadd(k, m)); return tx; },
      smembers: (k: string) => { ops.push(() => fakeRedis.smembers(k)); return tx; },
      scard: (k: string) => { ops.push(() => fakeRedis.scard(k)); return tx; },
      exec: async () => {
        if (failTxOnce) { failTxOnce = false; throw new Error("store blip"); }
        const out = []; for (const op of ops) out.push(await op());
        if (loseReplyOnce) { loseReplyOnce = false; throw new Error("reply lost"); }
        return out;
      },
    };
    return tx;
  },
};
vi.mock("@/lib/redis", () => ({ getRedis: () => fakeRedis }));
const awarded: any[] = [];
vi.mock("@/lib/proof-of-favour", () => ({ awardPoints: async (...a: any[]) => { awarded.push(a); } }));

import { JURY_DAILY_GOAL, getJuryDay, liveStreak, recordJuryDay, streakFromDays, utcDay } from "@/lib/jury-day";
import { issueJuryDeckWithMode, recordJuryVerdict } from "@/lib/jury";

const JUDGE = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
let mi = 0;
const m = () => `c:test-${++mi}`; // a fresh card per call: each call is one verdict

beforeEach(() => { kv.clear(); sets.clear(); hashes.clear(); fields.clear(); awarded.length = 0; failTxOnce = false; loseReplyOnce = false; process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME = "1"; });

describe("streakFromDays and liveStreak", () => {
  it("counts the run that ends on the last day played, and keeps the best", () => {
    expect(streakFromDays([])).toEqual({ last: null, current: 0, best: 0 });
    expect(streakFromDays(["2026-10-10"])).toEqual({ last: "2026-10-10", current: 1, best: 1 });
    expect(streakFromDays(["2026-10-11", "2026-10-10"])).toEqual({ last: "2026-10-11", current: 2, best: 2 });
    expect(streakFromDays(["2026-10-10", "2026-10-11", "2026-10-13"])).toEqual({ last: "2026-10-13", current: 1, best: 2 });
    expect(streakFromDays(["2026-10-11", "2026-10-11", "junk"])).toEqual({ last: "2026-10-11", current: 1, best: 1 });
  });
  it("crosses a month end", () => {
    expect(streakFromDays(["2026-10-30", "2026-10-31", "2026-11-01"]).current).toBe(3);
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
    for (let i = 0; i < JURY_DAILY_GOAL + 1; i++) seen.push(await recordJuryDay(JUDGE, D("2026-10-14"), m()));
    expect(seen.map((d) => d!.today)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seen.map((d) => d!.goalReachedNow).filter(Boolean)).toHaveLength(1);
    expect(seen[9]!.goalReachedNow).toBe(true);
    expect(seen[0]!.streak).toBe(1);
  });
  it("builds a streak across days and the read matches the write", async () => {
    await recordJuryDay(JUDGE, D("2026-10-12"), m());
    await recordJuryDay(JUDGE, D("2026-10-13"), m());
    const d = await recordJuryDay(JUDGE, D("2026-10-14"), m());
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

// R2 finding 7 and its re-review, 14 Oct 2026: the count landed and the
// streak write failed, so a day was played and never marked (3 days gave a
// streak of 1). The count and the day mark are now one transaction.
describe("the count and the day mark land together or not at all", () => {
  it("three days, one verdict each, read a streak of 3", async () => {
    await recordJuryDay(JUDGE, D("2026-10-12"), m());
    await recordJuryDay(JUDGE, D("2026-10-13"), m());
    expect(await recordJuryDay(JUDGE, D("2026-10-14"), m())).toMatchObject({ today: 1, streak: 3, best: 3 });
  });
  it("a failed transaction leaves no half state: no count without its day", async () => {
    await recordJuryDay(JUDGE, D("2026-10-13"), m());
    failTxOnce = true;
    await expect(recordJuryDay(JUDGE, D("2026-10-14"), m())).rejects.toThrow();
    expect(await getJuryDay(JUDGE, D("2026-10-14"))).toMatchObject({ today: 0, streak: 1 });
    expect(await recordJuryDay(JUDGE, D("2026-10-14"), m())).toMatchObject({ today: 1, streak: 2 });
  });
  // Re-review, new finding: a delayed write from before midnight moved the
  // stored last day backward. A set of days cannot move back.
  it("a late write for yesterday, after today's, leaves today's streak as it was", async () => {
    await recordJuryDay(JUDGE, D("2026-10-13"), m());
    await recordJuryDay(JUDGE, D("2026-10-14"), m());
    await recordJuryDay(JUDGE, D("2026-10-13"), m()); // the delayed request
    expect(await getJuryDay(JUDGE, D("2026-10-14"))).toMatchObject({ today: 1, streak: 2, best: 2 });
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
  it("a verdict carries no day and writes no jury:day or jury:days key", async () => {
    delete process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME;
    let n = 0;
    const pool = ["a queue at a bakery", "a bus timetable", "a shelf of milk", "a sunset"].map((d, i) => ({ id: `q${i}`, status: "completed", proofImageUrl: `/p/q${i}.jpg`, proofNote: null, description: d, category: "photo", location: "x",
      claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any);
    const { cards } = await issueJuryDeckWithMode(pool, JUDGE, () => `z-${++n}`);
    expect(cards.length).toBeGreaterThan(0);
    const r: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
    expect(r.day ?? null).toBeNull();
    expect([...kv.keys(), ...sets.keys()].filter((k) => k.startsWith("jury:day"))).toEqual([]);
  });
});

describe("the record route asks the same switch (source read)", () => {
  it("reads the day only when juryGameOn()", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(`${process.cwd()}/src/app/api/jury/record/route.ts`, "utf8")).toMatch(/judge && juryGameOn\(\) \? await getJuryDay/);
  });
});

// R2c, 14 Oct 2026: the day write failed AFTER the card was spent, so the retry
// answered "Card expired" and that day was lost for good (3 days read streak 1).
describe("a verdict whose day write fails can be sent again, and lands once", () => {
  const pool = (tag: string) => ["a queue at a bakery", "a bus timetable", "a shelf of milk", "a sunset"].map((d, i) => ({ id: `${tag}${i}`, status: "completed", proofImageUrl: `/p/${tag}${i}.jpg`, proofNote: null, description: d, category: "photo", location: "x",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any);
  const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00Z`));

  it("three days, the middle one failing first, read a streak of 3 after the retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let n = 0;
      const days = ["2026-10-12", "2026-10-13", "2026-10-14"];
      let last: any = null;
      for (const [k, iso] of days.entries()) {
        at(iso);
        const { cards } = await issueJuryDeckWithMode(pool(`d${k}-`), JUDGE, () => `r-${++n}`);
        if (iso === "2026-10-13") {
          failTxOnce = true;
          const failed: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
          expect(failed.error).toMatch(/not saved/);
          const before = awarded.length;
          last = await recordJuryVerdict(JUDGE, cards[0].cardId, true); // the same card, sent again
          expect(last.error).toBeUndefined();
          expect(awarded.length).toBeGreaterThanOrEqual(before);
        } else {
          last = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
        }
      }
      expect(last.day).toMatchObject({ date: "2026-10-14", today: 1, streak: 3, best: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("running the day write twice for one verdict counts it once", async () => {
    await recordJuryDay(JUDGE, D("2026-10-14"), "p:same");
    const d = await recordJuryDay(JUDGE, D("2026-10-14"), "p:same");
    expect(d).toMatchObject({ today: 1, goalReachedNow: false });
  });
});

// R2d, 14 Oct 2026: two live cards for one proof, answered either side of
// midnight, counted that proof on both days.
describe("a proof judged yesterday does not count today", () => {
  it("the second card on the same proof, after midnight, moves neither count nor streak", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const pool = ["a queue at a bakery", "a bus timetable", "a shelf of milk", "a sunset"].map((d, i) => ({ id: `mid${i}`, status: "completed", proofImageUrl: `/p/m${i}.jpg`, proofNote: null, description: d, category: "photo", location: "x",
        claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any);
      let n = 0;
      vi.setSystemTime(new Date("2026-10-13T23:59:00Z"));
      const deck1 = await issueJuryDeckWithMode(pool, JUDGE, () => `m1-${++n}`);
      const deck2 = await issueJuryDeckWithMode(pool, JUDGE, () => `m2-${++n}`);
      const { getCardAnswer } = await import("@/lib/jury");
      const live = async (cards: { cardId: string }[]) => {
        const out: { cardId: string; proof: string }[] = [];
        for (const c of cards) { const a = await getCardAnswer(c.cardId); if (a && !a.decoy && !a.practice) out.push({ cardId: c.cardId, proof: a.proofTaskId }); }
        return out;
      };
      const one = await live(deck1.cards), two = await live(deck2.cards);
      const first = one.find((c) => two.some((d) => d.proof === c.proof))!;
      expect(first).toBeTruthy();
      const twin = two.find((d) => d.proof === first.proof)!;
      await recordJuryVerdict(JUDGE, first.cardId, true);
      vi.setSystemTime(new Date("2026-10-14T00:01:00Z"));
      const after: any = await recordJuryVerdict(JUDGE, twin.cardId, true);
      expect(after.repeat).toBe(true);
      expect(await getJuryDay(JUDGE, Date.now())).toMatchObject({ today: 0, streak: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

// EDGES Oscar ruled to fix ("Fix the other things too", 14 Oct 2026).
describe("a proof counts on one day only, whatever the clock does", () => {
  const pool = (tag: string) => ["a queue at a bakery", "a bus timetable", "a shelf of milk", "a sunset"].map((d, i) => ({ id: `${tag}${i}`, status: "completed", proofImageUrl: `/p/${tag}${i}.jpg`, proofNote: null, description: d, category: "photo", location: "x",
    claimant: "0x1111111111111111111111111111111111111111", poster: "0x2222222222222222222222222222222222222222", verificationResult: { verdict: "pass", confidence: 0.9, reasoning: "ok" } }) as any);

  it("edge 1: the reply of 23:59 is lost after the write, the retry at 00:01 does not count a second day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let n = 0;
      vi.setSystemTime(new Date("2026-10-13T23:59:00Z"));
      const { cards } = await issueJuryDeckWithMode(pool("e1-"), JUDGE, () => `e1-${++n}`);
      loseReplyOnce = true;
      const lost: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
      expect(lost.error).toMatch(/not saved/);
      vi.setSystemTime(new Date("2026-10-14T00:01:00Z"));
      const retry: any = await recordJuryVerdict(JUDGE, cards[0].cardId, true);
      expect(retry.error).toBeUndefined();
      expect(retry.day).toMatchObject({ date: "2026-10-14", today: 0, streak: 1, best: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("edge 3: two cards on one proof, one either side of midnight, land on one day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-13T23:59:00Z"));
      const a = await recordJuryDay(JUDGE, Date.now(), "p:same-proof");
      vi.setSystemTime(new Date("2026-10-14T00:01:00Z"));
      const b = await recordJuryDay(JUDGE, Date.now(), "p:same-proof");
      expect(a).toMatchObject({ date: "2026-10-13", today: 1, streak: 1 });
      expect(b).toMatchObject({ date: "2026-10-14", today: 0, streak: 1, best: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

// CODEX REVIEW OF d4751f8 (EDGE): the day was reserved by HSETNX BEFORE the
// transaction. A transaction that never ran at 23:59 still pinned yesterday, so
// the retry at 00:01 counted on yesterday and today stayed 0. The reservation
// and the count must be one atomic step.
describe("the day is reserved only when the count is written", () => {
  it("a transaction that never ran at 23:59 pins nothing; the retry at 00:01 counts today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-13T23:59:00Z"));
      failTxOnce = true;
      await expect(recordJuryDay(JUDGE, Date.now(), "p:never-ran")).rejects.toThrow();
      vi.setSystemTime(new Date("2026-10-14T00:01:00Z"));
      const retry = await recordJuryDay(JUDGE, Date.now(), "p:never-ran");
      expect(retry).toMatchObject({ date: "2026-10-14", today: 1, streak: 1, best: 1 });
      expect((await getJuryDay(JUDGE, Date.parse("2026-10-13T23:59:30Z")))?.today).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
