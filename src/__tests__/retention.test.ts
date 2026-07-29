import { describe, it, expect } from "vitest";
import {
  computeRetention,
  rate,
  median,
  trend,
  summarise,
  utcDay,
  type RetentionReader,
  type DayRetention,
} from "@/lib/retention";

const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const DAY = 86_400_000;

describe("pure cohort math", () => {
  it("rate is null on an empty denominator, rounded otherwise", () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 3)).toBe(0.333);
    expect(rate(0, 10)).toBe(0);
  });

  it("median handles empty, odd, even", () => {
    expect(median([])).toBeNull();
    expect(median([0.5])).toBe(0.5);
    expect(median([0.2, 0.6, 0.4])).toBe(0.4);
    expect(median([0.2, 0.4])).toBe(0.3);
  });

  it("trend compares the last 3 usable rates against the prior 3", () => {
    expect(trend([0.5, 0.5, 0.5, 0.2, 0.2, 0.2])).toBe(-0.3);
    expect(trend([0.2, 0.2, 0.2, 0.5, 0.5, 0.5])).toBe(0.3);
    expect(trend([null, 0.5, null, 0.5])).toBeNull(); // not enough history
  });

  it("summarise skips null days instead of counting them as zero", () => {
    const day = (d1Rate: number | null): DayRetention => ({
      date: "2026-07-29",
      dau: 10,
      reach: 20,
      d1Returning: 5,
      d1Rate,
      d7Returning: 0,
      d7Rate: null,
      events: {},
    });
    const s = summarise([day(null), day(0.4), day(0.6)]);
    expect(s.medianD1Rate).toBe(0.5);
    expect(s.latestD1Rate).toBe(0.6);
  });
});

// A mock reader over synthetic day sets. Cohort truth is computed by hand
// below, so the assertion is against arithmetic, not against the code's own
// output re-derived.
function readerFor(reachByDay: Record<string, string[]>, eventsByDay: Record<string, Record<string, number>> = {}): RetentionReader {
  const setFor = (key: string): string[] => {
    const m = key.match(/^reach:(.+)$/);
    if (m) return reachByDay[m[1]] ?? [];
    return []; // visitors sets are context-only (dau) in these fixtures
  };
  return {
    scard: (async (key: string) => setFor(key).length) as RetentionReader["scard"],
    sinter: (async (a: string, b: string) => {
      const B = new Set(setFor(b));
      return setFor(a).filter((x) => B.has(x));
    }) as RetentionReader["sinter"],
    hgetall: (async (key: string) => {
      const m = key.match(/^events:daily:(.+)$/);
      return m ? (eventsByDay[m[1]] ?? null) : null;
    }) as RetentionReader["hgetall"],
  };
}

describe("computeRetention", () => {
  const d = (offset: number) => utcDay(NOW - offset * DAY);

  it("computes D1 return rate as returning/previous-day active devices", async () => {
    // Yesterday: alice, bob, carol. Today: alice, dave. D1 = 1/3.
    const reader = readerFor({
      [d(1)]: ["alice", "bob", "carol"],
      [d(0)]: ["alice", "dave"],
    });
    const report = await computeRetention(reader, { days: 2, now: NOW });
    const today = report.days[1];
    expect(today.date).toBe(d(0));
    expect(today.reach).toBe(2);
    expect(today.d1Returning).toBe(1);
    expect(today.d1Rate).toBe(0.333);
    // Yesterday has no day before it in the fixture → null, not 0.
    expect(report.days[0].d1Rate).toBeNull();
  });

  it("computes D7 against the cohort from a week earlier", async () => {
    const reader = readerFor({
      [d(7)]: ["alice", "bob", "carol", "dave"],
      [d(0)]: ["alice", "bob", "eve"],
    });
    const report = await computeRetention(reader, { days: 2, now: NOW });
    const today = report.days[1];
    expect(today.d7Returning).toBe(2);
    expect(today.d7Rate).toBe(0.5);
  });

  it("carries the day's funnel events through", async () => {
    const reader = readerFor(
      { [d(0)]: ["alice"] },
      { [d(0)]: { jury_verdict: 120, task_created: 3, cap_hit: 5, ignored_event: 999 } },
    );
    const report = await computeRetention(reader, { days: 2, now: NOW });
    const today = report.days[1];
    expect(today.events.jury_verdict).toBe(120);
    expect(today.events.task_created).toBe(3);
    expect(today.events.cap_hit).toBe(5);
    expect(today.events.ignored_event).toBeUndefined(); // allowlist, not passthrough
  });

  it("dead days produce zeros and nulls, never NaN", async () => {
    const report = await computeRetention(readerFor({}), { days: 3, now: NOW });
    for (const day of report.days) {
      expect(day.dau).toBe(0);
      expect(day.d1Rate).toBeNull();
      expect(day.d7Rate).toBeNull();
    }
    expect(report.summary.medianD1Rate).toBeNull();
    expect(report.summary.d1Trend).toBeNull();
  });

  it("clamps the window and orders days oldest→newest", async () => {
    const report = await computeRetention(readerFor({}), { days: 500, now: NOW });
    expect(report.days).toHaveLength(30);
    expect(report.days[0].date < report.days[29].date).toBe(true);
    expect(report.to).toBe(d(0));
  });
});
