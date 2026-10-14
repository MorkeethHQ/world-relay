import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// THE NORTH STAR (14 Oct 2026): outside jurors per day and completed favours
// per day, without the operator, TEST DATA wallets or NORTH_STAR_EXCLUDE.

const store = vi.hoisted(() => ({ sets: new Map<string, Set<string>>(), failSadd: false }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    sadd: async (k: string, ...m: string[]) => {
      if (store.failSadd) throw new Error("store down");
      const s = store.sets.get(k) ?? new Set<string>(); let n = 0;
      for (const x of m) if (!s.has(x)) { s.add(x); n++; }
      store.sets.set(k, s); return n;
    },
    expire: async () => 1,
    smembers: async (k: string) => [...(store.sets.get(k) ?? [])],
  }),
}));

import { excludedFromEnv, isOutside, northStarDay, noteCompleted, noteJuror, nsCompletedKey, nsJurorsKey, readNorthStar } from "@/lib/north-star";

const OUT1 = "0x" + "1".repeat(40), OUT2 = "0x" + "2".repeat(40);
const OSCAR = "0x" + "a".repeat(40);
const FIXTURE = "0x7e57da7a000000000000000000000000000000b2";
const NOW = Date.parse("2026-10-14T12:00:00Z");
const src = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
// The writes run in the background now; let them land.
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { store.sets.clear(); store.failSadd = false; });

describe("who counts as outside", () => {
  const ex = excludedFromEnv({ NORTH_STAR_EXCLUDE: ` ${OSCAR.toUpperCase().replace("0X", "0x")} , ` });
  it("a real wallet counts, in any case", () => {
    expect(isOutside(OUT1, ex)).toBe(true);
    expect(isOutside(OUT1.toUpperCase().replace("0X", "0x"), ex)).toBe(true);
  });
  // The operator wallet is excluded through NORTH_STAR_EXCLUDE like any other:
  // no wallet is written into the repo (Codex, 14 Oct 2026).
  it("TEST DATA wallets and the env list do not", () => {
    expect(isOutside(FIXTURE, ex)).toBe(false);
    expect(isOutside(OSCAR, ex)).toBe(false);
  });
  it("a non-wallet id does not (dev_, agent:, anonymous)", () => {
    for (const id of ["dev_abc", "agent:relay", "", "0x123"]) expect(isOutside(id, ex)).toBe(false);
  });
});

describe("one day's numbers", () => {
  it("distinct outside jurors, distinct outside (favour, person) completions", () => {
    const ex = new Set([OSCAR]);
    const d = northStarDay("2026-10-14", [OUT1, OUT1.toUpperCase().replace("0X", "0x"), OUT2, OSCAR, FIXTURE], [`f1:${OUT1}`, `f1:${OUT1}`, `f2:${OUT1}`, `f1:${OSCAR}`, `f3:${FIXTURE}`], ex);
    expect(d).toEqual({ day: "2026-10-14", outsideJurors: 2, completedFavours: 2 });
  });
});

describe("the day keys are written once per person or pair", () => {
  it("a juror twice in a day is one member; a completion twice is one member", async () => {
    noteJuror(OUT1, NOW); noteJuror(OUT1.toUpperCase().replace("0X", "0x"), NOW + 1000);
    noteCompleted("f1", OUT1, NOW); noteCompleted("f1", OUT1, NOW + 1000);
    await settle();
    expect(store.sets.get(nsJurorsKey("2026-10-14"))?.size).toBe(1);
    expect(store.sets.get(nsCompletedKey("2026-10-14"))?.size).toBe(1);
  });
  it("a store failure is swallowed, so a verdict or completion never fails on the counter", async () => {
    store.failSadd = true;
    expect(() => noteJuror(OUT1, NOW)).not.toThrow();
    expect(() => noteCompleted("f1", OUT1, NOW)).not.toThrow();
    await settle();
  });
  it("readNorthStar gives counts per day and no wallet", async () => {
    noteJuror(OUT1, NOW); noteJuror(OSCAR, NOW); noteCompleted("f1", OUT2, NOW - 86400_000);
    await settle();
    const days = await readNorthStar(2, NOW, new Set([OSCAR]));
    expect(days).toEqual([
      { day: "2026-10-14", outsideJurors: 1, completedFavours: 0, jurorsBackNextDay: null },
      { day: "2026-10-13", outsideJurors: 0, completedFavours: 1, jurorsBackNextDay: 0 },
    ]);
    expect(JSON.stringify(days)).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});

describe("the recorders sit after the write they count", () => {
  it("jury: noteJuror runs after the proof is marked judged, never before the card is consumed", () => {
    const j = src("src/lib/jury.ts");
    const fn = j.slice(j.indexOf("export async function recordJuryVerdict"));
    const judged = fn.indexOf("const firstOnProof = await redis.sadd(`jury:judged:");
    const note = fn.indexOf("noteJuror(judge)");
    expect(judged).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(judged);
    expect(fn.indexOf("if (answer.practice)")).toBeLessThan(note);
  });
  it("completions: noteCompleted runs after the History row is written", () => {
    const c = src("src/lib/completions.ts");
    const fn = c.slice(c.indexOf("export async function recordTaskCompletion"));
    expect(fn.indexOf("noteCompleted(")).toBeGreaterThan(fn.indexOf("await redis.lpush(contributionsKey(addr)"));
  });
  it("/api/stats carries the northStar block", () => {
    expect(src("src/app/api/stats/route.ts")).toMatch(/northStar: await readNorthStar\(/);
  });
});
