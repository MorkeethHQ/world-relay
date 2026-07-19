import { describe, it, expect, beforeEach, vi } from "vitest";

// THE TOP FAVOUR — guard tests for the daily gate.
//
// Two invariants carry the whole design and both are easy to break silently:
//
//  1. THE LOCK. Results must never reach a caller who has not contributed. If
//     this leaks, the gate stops being an unwrapping and becomes a pointless
//     toll — people read the reveal and never submit.
//  2. ONE PER HUMAN PER DAY. Resubmission must be REJECTED, not merged. A merge
//     would let someone peek at a friend's reveal and then edit their own answer,
//     which poisons the index and makes the guess mechanic meaningless.
//
// Everything else here exists because it is arithmetic on other people's answers
// and a wrong verdict line is the one thing every single user sees.

const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (k: string) => strings.get(k) ?? null,
    set: async (k: string, v: string) => { strings.set(k, v); return "OK"; },
    hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
    hgetall: async (k: string) => {
      const h = hashes.get(k);
      if (!h) return null;
      return Object.fromEntries(h.entries());
    },
    hsetnx: async (k: string, f: string, v: string) => {
      if (!hashes.has(k)) hashes.set(k, new Map());
      const h = hashes.get(k)!;
      if (h.has(f)) return 0;
      h.set(f, v);
      return 1;
    },
  }),
}));

const awarded: Array<{ address: string; action: string; points: number }> = [];
vi.mock("@/lib/proof-of-favour", () => ({
  awardPoints: async (address: string, action: string, points: number) => {
    awarded.push({ address, action, points });
    return {} as any;
  },
}));

import {
  submitDaily,
  getResults,
  hasSubmitted,
  getStreak,
  promptForDate,
  getPrompt,
  utcDate,
  DAILY_POINTS,
  DAILY_STREAK_BONUS,
} from "@/lib/daily";

const DATE = "2026-07-20";
const A = "0xaaa";
const B = "0xbbb";
const C = "0xccc";

// Pin a known CHOICE prompt so the assertions below are about the mechanic, not
// about which prompt the hash happened to pick.
async function useChoicePrompt(date = DATE) {
  strings.set(
    `daily:prompt:${date}`,
    JSON.stringify({ question: "Inside or outside?", type: "choice", options: ["Inside", "Outside"] }),
  );
}

async function useNumberPrompt(date = DATE) {
  strings.set(
    `daily:prompt:${date}`,
    JSON.stringify({ question: "How many hours did you sleep?", type: "number", unit: "hours" }),
  );
}

beforeEach(() => {
  hashes.clear();
  strings.clear();
  awarded.length = 0;
});

describe("the lock — results are unreachable without contributing", () => {
  it("returns null for someone who has not submitted", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });

    expect(await getResults(DATE, B)).toBeNull();
  });

  it("opens the moment they submit, and not before", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });

    expect(await getResults(DATE, B)).toBeNull();
    await submitDaily({ date: DATE, address: B, answer: "Outside", guess: "Inside" });
    const after = await getResults(DATE, B);

    expect(after).not.toBeNull();
    expect(after!.total).toBe(2);
  });

  it("never leaks another person's answer as your own", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Outside" });
    await submitDaily({ date: DATE, address: B, answer: "Outside", guess: "Outside" });

    const a = await getResults(DATE, A);
    const b = await getResults(DATE, B);
    expect(a!.yourAnswer).toBe("Inside");
    expect(b!.yourAnswer).toBe("Outside");
  });
});

describe("one per human per day", () => {
  it("rejects a second submission rather than merging it", async () => {
    await useChoicePrompt();
    const first = await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    const second = await submitDaily({ date: DATE, address: A, answer: "Outside", guess: "Outside" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already done/i);
  });

  it("keeps the ORIGINAL answer after a rejected resubmission", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: A, answer: "Outside", guess: "Outside" });

    const r = await getResults(DATE, A);
    expect(r!.yourAnswer).toBe("Inside");
    expect(r!.total).toBe(1);
  });

  it("counts each human once in the world total", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: B, answer: "Inside", guess: "Inside" });

    const r = await getResults(DATE, A);
    expect(r!.total).toBe(2);
  });
});

describe("validation", () => {
  it("rejects an answer that is not one of today's options", async () => {
    await useChoicePrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "Sideways", guess: "Inside" });
    expect(r.ok).toBe(false);
  });

  it("requires a guess — the first beat of the loop is not optional", async () => {
    await useChoicePrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/guess/i);
  });

  it("rejects a non-numeric answer on a number prompt", async () => {
    await useNumberPrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "loads", guess: "7" });
    expect(r.ok).toBe(false);
  });
});

describe("you vs the world", () => {
  it("names the majority when you are in it", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: B, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: C, answer: "Outside", guess: "Inside" });

    const r = await getResults(DATE, A);
    expect(r!.verdict).toMatch(/majority/i);
    expect(r!.distribution).toEqual({ Inside: 2, Outside: 1 });
  });

  it("tells you when you are the odd one out, and what most said", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Outside", guess: "Outside" });
    await submitDaily({ date: DATE, address: B, answer: "Inside", guess: "Inside" });
    await submitDaily({ date: DATE, address: C, answer: "Inside", guess: "Inside" });

    const r = await getResults(DATE, A);
    expect(r!.verdict).toMatch(/only/i);
    expect(r!.verdict).toContain("Inside");
  });

  it("computes a median and a percentile on number prompts", async () => {
    await useNumberPrompt();
    await submitDaily({ date: DATE, address: A, answer: "9", guess: "7" });
    await submitDaily({ date: DATE, address: B, answer: "7", guess: "7" });
    await submitDaily({ date: DATE, address: C, answer: "5", guess: "7" });

    const r = await getResults(DATE, A);
    expect(r!.median).toBe(7);
    expect(r!.percentile).toBe(67); // 2 of 3 answered below 9
    expect(r!.verdict).toMatch(/above/i);
  });

  it("greets the first person on earth rather than dividing by zero", async () => {
    await useChoicePrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.results.verdict).toMatch(/first person on earth/i);
  });
});

describe("points and streaks", () => {
  it("awards the base points for showing up", async () => {
    await useChoicePrompt();
    await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Outside" });
    expect(awarded[0].points).toBe(DAILY_POINTS);
    expect(awarded[0].action).toBe("daily_favour");
  });

  it("starts a streak at 1 and pays no bonus yet", async () => {
    await useChoicePrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Outside" });
    if (r.ok) expect(r.streak).toBe(1);
    expect(await getStreak(A)).toBe(1);
  });

  it("extends the streak across consecutive days and pays the bonus from day 3", async () => {
    for (const [i, d] of ["2026-07-18", "2026-07-19", "2026-07-20"].entries()) {
      await useChoicePrompt(d);
      const r = await submitDaily({ date: d, address: A, answer: "Inside", guess: "Outside" });
      if (r.ok) expect(r.streak).toBe(i + 1);
    }
    // Day 3 carries the streak bonus; days 1 and 2 do not.
    expect(awarded[0].points).toBe(DAILY_POINTS);
    expect(awarded[2].points).toBe(DAILY_POINTS + DAILY_STREAK_BONUS);
  });

  it("resets the streak when a day is missed", async () => {
    await useChoicePrompt("2026-07-18");
    await submitDaily({ date: "2026-07-18", address: A, answer: "Inside", guess: "Outside" });
    // skip the 19th
    await useChoicePrompt("2026-07-20");
    const r = await submitDaily({ date: "2026-07-20", address: A, answer: "Inside", guess: "Outside" });
    if (r.ok) expect(r.streak).toBe(1);
  });

  it("does not lose the submission when awarding points throws", async () => {
    await useChoicePrompt();
    const r = await submitDaily({ date: DATE, address: A, answer: "Inside", guess: "Inside" });
    expect(r.ok).toBe(true);
    expect(await hasSubmitted(DATE, A)).toBe(true);
  });
});

describe("the prompt", () => {
  it("is the same question for everyone on earth on a given day", async () => {
    const a = promptForDate("2026-08-01");
    const b = promptForDate("2026-08-01");
    expect(a.question).toBe(b.question);
  });

  it("changes from day to day", () => {
    const week = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    const qs = new Set(week.map((d) => promptForDate(d).question));
    expect(qs.size).toBeGreaterThan(1);
  });

  it("every gate prompt is answerable anywhere — none require a shop, landmark or travel", async () => {
    // The constraint that decides whether the gate delights or locks people out
    // of their own app. Location-dependent prompts belong in the weekly mission.
    const { PROMPTS } = await import("@/lib/daily");
    const banned = /price|cost|shop|store|supermarket|buy|receipt|landmark|street sign|museum/i;
    for (const p of PROMPTS) {
      expect(banned.test(p.question), `"${p.question}" is location-dependent`).toBe(false);
    }
  });

  it("survives a corrupt stored prompt rather than taking the gate down", async () => {
    strings.set(`daily:prompt:${DATE}`, "{not json");
    const p = await getPrompt(DATE);
    expect(p.question).toBe(promptForDate(DATE).question);
  });

  it("derives the day in UTC so the world rolls over together", () => {
    expect(utcDate(Date.parse("2026-07-20T23:59:00Z"))).toBe("2026-07-20");
    expect(utcDate(Date.parse("2026-07-21T00:01:00Z"))).toBe("2026-07-21");
  });
});

// ── The hole that a real probe found and the unit tests did not ──────────────
// The route originally used ownershipError(), which honours the SESSION_ENFORCE
// kill switch. That switch ships OFF (so deploying sessions could not lock out
// returning users on the EXISTING routes), which meant an unauthenticated POST
// with an arbitrary address SUCCEEDED against the running app: index poisoned,
// points farmed. Caught only by driving the live endpoint, never by tsc or by
// the logic tests above.
//
// This route is new and has no legacy callers, so it requires a real session
// unconditionally. These cases fail if anyone reintroduces ownershipError() or
// relaxes the wallet-shape check.
describe("the daily route requires a real session, kill switch or not", () => {
  it("does not use the SESSION_ENFORCE-gated helper", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/daily/route.ts", "utf8"),
    );
    // Strip comments first. The guard is documented in a comment that names the
    // helper it deliberately avoids, so grepping raw source matches its own
    // documentation and goes red for the wrong reason. Test the CODE.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/ownershipError/);
    expect(src).toMatch(/getAuthedAddress/);
    expect(src).toMatch(/addressMatches/);
  });

  it("rejects any address that is not a real 0x wallet", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/daily/route.ts", "utf8"),
    );
    expect(src).toMatch(/\^0x\[0-9a-fA-F\]\{40\}\$/);
  });
});
