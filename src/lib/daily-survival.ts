import { daysCompletedInWeek, isoWeekOf, listWeekActives, utcDate } from "./daily";

// THE KILL NUMBER. The 4-week call on the daily loop is:
//
//   median active-user days/week
//
// — of the people who showed up at all in a week, how many days did the median
// one come back? 1 means the gate is a one-shot curiosity and dies. 3+ means a
// ritual is forming. This file computes it from the history sets written at
// submit time in lib/daily.recordHistory; scripts/daily-survival.ts prints it.
//
// Pure math lives in computeWeekSurvival so tests never need Redis.

export type WeekSurvival = {
  week: string; // "2026-W30"
  actives: number; // addresses with >=1 completion this week
  medianDaysPerWeek: number; // THE metric
  meanDaysPerWeek: number;
  daysDistribution: Record<string, number>; // "1".."7" -> count of users
  retainedFromPrev: number | null; // share of prev week's actives seen this week
};

export function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeWeekSurvival(
  week: string,
  perAddressDays: Record<string, number>,
  prevWeekActives: string[] | null,
): WeekSurvival {
  const entries = Object.entries(perAddressDays).filter(([, d]) => d > 0);
  const days = entries.map(([, d]) => d);
  const daysDistribution: Record<string, number> = {};
  for (const d of days) {
    const k = String(Math.min(d, 7));
    daysDistribution[k] = (daysDistribution[k] || 0) + 1;
  }
  let retainedFromPrev: number | null = null;
  if (prevWeekActives) {
    if (!prevWeekActives.length) {
      retainedFromPrev = null; // no denominator, not a zero
    } else {
      const current = new Set(entries.map(([a]) => a));
      const kept = prevWeekActives.filter((a) => current.has(a)).length;
      retainedFromPrev = kept / prevWeekActives.length;
    }
  }
  return {
    week,
    actives: entries.length,
    medianDaysPerWeek: medianOf(days),
    meanDaysPerWeek: days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0,
    daysDistribution,
    retainedFromPrev,
  };
}

// The last `weeksBack` ISO weeks ending at `now`, oldest first.
export function recentIsoWeeks(now: number, weeksBack: number): string[] {
  const weeks: string[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    weeks.push(isoWeekOf(utcDate(now - i * 7 * 86400000)));
  }
  // Dedupe: two nows can land in the same ISO week at boundaries.
  return [...new Set(weeks)];
}

export async function readSurvival(now: number, weeksBack = 6): Promise<WeekSurvival[]> {
  const weeks = recentIsoWeeks(now, weeksBack);
  const out: WeekSurvival[] = [];
  let prevActives: string[] | null = null;
  for (const week of weeks) {
    const actives = await listWeekActives(week);
    const perAddressDays: Record<string, number> = {};
    // Sequential-ish on purpose: this runs from a readout script, never a route.
    const BATCH = 50;
    for (let i = 0; i < actives.length; i += BATCH) {
      const chunk = actives.slice(i, i + BATCH);
      const counts = await Promise.all(chunk.map((a) => daysCompletedInWeek(a, week)));
      chunk.forEach((a, j) => (perAddressDays[a] = counts[j]));
    }
    out.push(computeWeekSurvival(week, perAddressDays, prevActives));
    prevActives = actives;
  }
  return out;
}
