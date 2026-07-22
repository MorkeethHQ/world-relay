import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// THE DAILY-RETURN LOOP — survival history, time capsule, comeback notifications.
//
// What must never break, in order:
//
//  1. HISTORY IS WRITTEN AT SUBMIT TIME. The kill-number metric (median
//     active-user days/week) reads sets that only exist if submitDaily wrote
//     them. An unmeasured day is gone forever.
//  2. THE CAPSULE PERSISTS. The per-day aggregate is rebuildable only while the
//     raw submissions hash lives; the capsule is the permanent copy.
//  3. NOTIFICATIONS SHIP DARK. With DAILY_NOTIFY_ENFORCE unset, no pass may
//     touch the transport. Flag on: deduped once per day, capped, and never
//     sent to someone who already answered today.

const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();
const sets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (k: string) => strings.get(k) ?? null,
    set: async (k: string, v: string, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && strings.has(k)) return null;
      strings.set(k, v);
      return "OK";
    },
    hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
    hgetall: async (k: string) => {
      const h = hashes.get(k);
      if (!h) return null;
      return Object.fromEntries(h.entries());
    },
    hkeys: async (k: string) => [...(hashes.get(k)?.keys() ?? [])],
    hsetnx: async (k: string, f: string, v: string) => {
      if (!hashes.has(k)) hashes.set(k, new Map());
      const h = hashes.get(k)!;
      if (h.has(f)) return 0;
      h.set(f, v);
      return 1;
    },
    sadd: async (k: string, v: string) => {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(v);
      return 1;
    },
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
    scard: async (k: string) => sets.get(k)?.size ?? 0,
    expire: async () => 1,
    lpush: async () => 1,
    ltrim: async () => "OK",
    hincrby: async () => 1,
  }),
}));

vi.mock("@/lib/proof-of-favour", () => ({
  awardPoints: async () => ({}) as unknown,
}));

// The World transport, mocked whole — nothing in this suite may fetch.
const newDailySends: Array<{ addresses: string[]; question: string }> = [];
const riskSends: Array<{ address: string; streak: number }> = [];
vi.mock("@/lib/notifications", () => ({
  notifyNewDaily: async (addresses: string[], question: string) => {
    newDailySends.push({ addresses, question });
    return addresses.length;
  },
  notifyStreakAtRisk: async (address: string, streak: number) => {
    riskSends.push({ address, streak });
    return true;
  },
}));

import {
  submitDaily,
  isoWeekOf,
  listSubmitters,
  listWeekActives,
  daysCompletedInWeek,
  getCapsule,
  listCapsuleDates,
  buildCapsule,
  promptForDate,
} from "@/lib/daily";
import { computeWeekSurvival, medianOf, recentIsoWeeks } from "@/lib/daily-survival";
import {
  runDailyNotifyPass,
  runNewDailyPass,
  runStreakAtRiskPass,
  newDailyAudience,
  streakAtRiskAudience,
  DAILY_NOTIFY_FLAG,
  STREAK_RISK_SEND_CAP,
} from "@/lib/daily-notify";

const DATE = "2026-07-20"; // a Monday; isoWeekOf -> 2026-W30
const WEEK = "2026-W30";
const A = "0xaaa";
const B = "0xbbb";

function useChoicePrompt(date = DATE) {
  strings.set(
    `daily:prompt:${date}`,
    JSON.stringify({ question: "Inside or outside?", type: "choice", options: ["Inside", "Outside"] }),
  );
}

function useNumberPrompt(date = DATE) {
  strings.set(
    `daily:prompt:${date}`,
    JSON.stringify({ question: "How many hours did you sleep?", type: "number", unit: "hours" }),
  );
}

async function submit(address: string, date: string, answer: string, guess: string) {
  return submitDaily({ date, address, answer, guess });
}

beforeEach(() => {
  hashes.clear();
  strings.clear();
  sets.clear();
  newDailySends.length = 0;
  riskSends.length = 0;
  delete process.env[DAILY_NOTIFY_FLAG];
});

afterEach(() => {
  delete process.env[DAILY_NOTIFY_FLAG];
});

describe("isoWeekOf", () => {
  it("maps a known Monday to its ISO week", () => {
    expect(isoWeekOf("2026-07-20")).toBe("2026-W30");
    expect(isoWeekOf("2026-07-26")).toBe("2026-W30"); // the Sunday of the same week
    expect(isoWeekOf("2026-07-27")).toBe("2026-W31");
  });

  it("handles the year boundary by Thursday ownership", () => {
    // Jan 1 2027 is a Friday -> belongs to 2026's last week (W53).
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekOf("2027-01-04")).toBe("2027-W01"); // first Monday of 2027
  });
});

describe("survival history (invariant 1: written at submit time)", () => {
  it("records the day and the active address at submit", async () => {
    useChoicePrompt();
    const r = await submit(A, DATE, "Inside", "Inside");
    expect(r.ok).toBe(true);
    expect(await listWeekActives(WEEK)).toEqual([A]);
    expect(await daysCompletedInWeek(A, WEEK)).toBe(1);
  });

  it("accumulates distinct days across a week, and a rejected resubmission writes nothing new", async () => {
    useChoicePrompt("2026-07-20");
    useChoicePrompt("2026-07-21");
    await submit(A, "2026-07-20", "Inside", "Inside");
    await submit(A, "2026-07-21", "Outside", "Inside");
    const dup = await submit(A, "2026-07-21", "Inside", "Outside");
    expect(dup.ok).toBe(false);
    expect(await daysCompletedInWeek(A, WEEK)).toBe(2);
    expect(await listWeekActives(WEEK)).toEqual([A]);
  });

  it("keeps weeks separate", async () => {
    useChoicePrompt("2026-07-26"); // Sunday, W30
    useChoicePrompt("2026-07-27"); // Monday, W31
    await submit(A, "2026-07-26", "Inside", "Inside");
    await submit(A, "2026-07-27", "Inside", "Inside");
    expect(await daysCompletedInWeek(A, "2026-W30")).toBe(1);
    expect(await daysCompletedInWeek(A, "2026-W31")).toBe(1);
  });
});

describe("kill-number math (computeWeekSurvival)", () => {
  it("medianOf handles odd, even, empty", () => {
    expect(medianOf([])).toBe(0);
    expect(medianOf([3])).toBe(3);
    expect(medianOf([1, 7])).toBe(4);
    expect(medianOf([1, 2, 7])).toBe(2);
  });

  it("computes the median days/week and the histogram", () => {
    const w = computeWeekSurvival("2026-W30", { a: 1, b: 1, c: 3, d: 7 }, null);
    expect(w.actives).toBe(4);
    expect(w.medianDaysPerWeek).toBe(2); // (1+3)/2
    expect(w.daysDistribution).toEqual({ "1": 2, "3": 1, "7": 1 });
    expect(w.retainedFromPrev).toBeNull();
  });

  it("computes week-over-week retention against the previous actives", () => {
    const w = computeWeekSurvival("2026-W31", { a: 2, x: 1 }, ["a", "b", "c", "d"]);
    expect(w.retainedFromPrev).toBe(0.25); // only a came back
  });

  it("zero-day entries never count as active", () => {
    const w = computeWeekSurvival("2026-W30", { a: 0, b: 2 }, null);
    expect(w.actives).toBe(1);
    expect(w.medianDaysPerWeek).toBe(2);
  });

  it("recentIsoWeeks walks backwards without duplicates", () => {
    const weeks = recentIsoWeeks(new Date("2026-07-22T12:00:00Z").getTime(), 3);
    expect(weeks).toEqual(["2026-W28", "2026-W29", "2026-W30"]);
  });
});

describe("time capsule (invariant 2: the permanent archive)", () => {
  it("persists question + distribution at submit, and indexes the date", async () => {
    useChoicePrompt();
    await submit(A, DATE, "Inside", "Inside");
    await submit(B, DATE, "Outside", "Inside");
    const capsule = await getCapsule(DATE);
    expect(capsule).not.toBeNull();
    expect(capsule!.question).toBe("Inside or outside?");
    expect(capsule!.total).toBe(2);
    expect(capsule!.distribution).toEqual({ Inside: 1, Outside: 1 });
    expect(await listCapsuleDates()).toEqual([DATE]);
  });

  it("carries the median for number prompts and updates on every submit", async () => {
    useNumberPrompt();
    await submit(A, DATE, "6", "7");
    expect((await getCapsule(DATE))!.median).toBe(6);
    await submit(B, DATE, "8", "7");
    const capsule = await getCapsule(DATE);
    expect(capsule!.median).toBe(7);
    expect(capsule!.total).toBe(2);
  });

  it("buildCapsule never leaks per-address data", () => {
    const prompt = { ...promptForDate(DATE), type: "choice" as const, options: ["Yes", "No"] };
    const capsule = buildCapsule(prompt, [
      { answer: "Yes", guess: "Yes", at: "t" },
      { answer: "No", guess: "Yes", at: "t" },
    ]);
    const flat = JSON.stringify(capsule);
    expect(flat).not.toContain("0x");
    expect(flat).not.toContain("guess");
    expect(capsule.total).toBe(2);
  });
});

describe("comeback notifications (invariant 3: dark, deduped, capped)", () => {
  it("does NOTHING with the flag unset — the dark-ship guarantee", async () => {
    useChoicePrompt();
    await submit(A, DATE, "Inside", "Inside");
    const r = await runDailyNotifyPass(new Date(`${DATE}T08:00:00Z`).getTime());
    expect(r.enabled).toBe(false);
    expect(newDailySends).toHaveLength(0);
    expect(riskSends).toHaveLength(0);
  });

  it("new-daily: notifies recent actives who have NOT answered today", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    // A and B were active yesterday (same ISO week); A already answered today.
    useChoicePrompt("2026-07-21");
    useChoicePrompt("2026-07-22");
    await submit(A, "2026-07-21", "Inside", "Inside");
    await submit(B, "2026-07-21", "Inside", "Inside");
    await submit(A, "2026-07-22", "Inside", "Inside");

    const now = new Date("2026-07-22T00:10:00Z").getTime();
    const r = await runDailyNotifyPass(now);
    expect(r.pass).toBe("new-daily");
    expect(r.audience).toBe(1);
    expect(newDailySends).toHaveLength(1);
    expect(newDailySends[0].addresses).toEqual([B]);
    expect(newDailySends[0].question).toBe("Inside or outside?");
  });

  it("new-daily: includes LAST week's actives (the comeback case)", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    useChoicePrompt("2026-07-19"); // Sunday, W29
    await submit(B, "2026-07-19", "Inside", "Inside");
    useChoicePrompt("2026-07-22"); // Wednesday, W30
    const audience = await newDailyAudience("2026-07-22");
    expect(audience).toEqual([B]);
  });

  it("new-daily: fires at most once per day (dedupe wins over a cron retry)", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    useChoicePrompt("2026-07-21");
    await submit(B, "2026-07-21", "Inside", "Inside");
    useChoicePrompt("2026-07-22");
    const now = new Date("2026-07-22T00:10:00Z").getTime();
    const first = await runNewDailyPass(now);
    const second = await runNewDailyPass(now);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(newDailySends).toHaveLength(1);
  });

  it("streak-at-risk: picks yesterday's submitters who are silent today with a streak worth saving", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    // Build A a 2-day streak ending yesterday; B submitted yesterday, streak 1.
    useChoicePrompt("2026-07-20");
    useChoicePrompt("2026-07-21");
    useChoicePrompt("2026-07-22");
    await submit(A, "2026-07-20", "Inside", "Inside");
    await submit(A, "2026-07-21", "Inside", "Inside");
    await submit(B, "2026-07-21", "Inside", "Inside");

    const audience = await streakAtRiskAudience("2026-07-22");
    expect(audience).toEqual([{ address: A, streak: 2 }]);

    const r = await runStreakAtRiskPass(new Date("2026-07-22T22:00:00Z").getTime());
    expect(r.sent).toBe(1);
    expect(riskSends).toEqual([{ address: A, streak: 2 }]);
  });

  it("streak-at-risk: never notifies someone who already answered today", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    useChoicePrompt("2026-07-20");
    useChoicePrompt("2026-07-21");
    useChoicePrompt("2026-07-22");
    await submit(A, "2026-07-20", "Inside", "Inside");
    await submit(A, "2026-07-21", "Inside", "Inside");
    await submit(A, "2026-07-22", "Inside", "Inside"); // already safe
    expect(await streakAtRiskAudience("2026-07-22")).toEqual([]);
  });

  it("streak-at-risk: respects the hard send cap", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    useChoicePrompt("2026-07-20");
    useChoicePrompt("2026-07-21");
    const n = STREAK_RISK_SEND_CAP + 25;
    for (let i = 0; i < n; i++) {
      const addr = `0x${String(i).padStart(4, "0")}`;
      await submit(addr, "2026-07-20", "Inside", "Inside");
      await submit(addr, "2026-07-21", "Inside", "Inside");
    }
    const audience = await streakAtRiskAudience("2026-07-22");
    expect(audience.length).toBe(STREAK_RISK_SEND_CAP);
  });

  it("routes by hour: evening = streak-at-risk, morning = new-daily", async () => {
    process.env[DAILY_NOTIFY_FLAG] = "true";
    const morning = await runDailyNotifyPass(new Date("2026-07-22T00:10:00Z").getTime());
    const evening = await runDailyNotifyPass(new Date("2026-07-22T22:00:00Z").getTime());
    expect(morning.pass).toBe("new-daily");
    expect(evening.pass).toBe("streak-at-risk");
  });

  it("submitters listing reflects the raw hash exactly", async () => {
    useChoicePrompt();
    await submit(A, DATE, "Inside", "Inside");
    await submit(B, DATE, "Outside", "Outside");
    expect((await listSubmitters(DATE)).sort()).toEqual([A, B]);
  });
});
