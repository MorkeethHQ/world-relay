import { getRedis } from "./redis";

// THE JURY AS A DAILY GAME (day bet, 14 Oct 2026). Oscar: "All of them for
// sure" (CURRENT.md, 14 Oct). Measured before it: 361 verdicts in the 7 days
// to 13 Oct, against a deck of 10 cards (/api/stats/retention).
//
// Two numbers, both written by the server at verdict time and never by the
// client: how many verdicts this person gave today (UTC), and how many days in
// a row they gave at least one. The screen draws the count, the streak and the
// goal moment from these numbers only. Nothing here awards points: a right
// call still pays 1 point under the existing daily cap (lib/jury.ts).
//
// Practice verdicts count too. Practice is play on real, already judged proofs
// and pays nothing, so a streak kept on practice buys nothing either.

export const JURY_DAILY_GOAL = 10; // one full deck (JURY_DECK_SIZE)

export type JuryStreak = { last: string | null; current: number; best: number };
export type JuryDay = { date: string; today: number; goal: number; streak: number; best: number; goalReachedNow: boolean };

const EMPTY: JuryStreak = { last: null, current: 0, best: 0 };

/** The UTC day of a moment, as YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
}

/** The streak as it reads on `day`: alive if the last verdict day was today or yesterday, else 0. Pure. */
export function liveStreak(s: JuryStreak, day: string): number {
  return s.last === day || s.last === dayBefore(day) ? s.current : 0;
}

const countKey = (judge: string, day: string) => `jury:day:${judge.toLowerCase()}:${day}`;
const daysKey = (judge: string) => `jury:days:${judge.toLowerCase()}`;

/** The streak from the set of days played. Pure. A set only grows, so a late
 *  or repeated write can never move the streak backward. */
export function streakFromDays(days: readonly string[]): JuryStreak {
  const played = new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  if (played.size === 0) return EMPTY;
  const sorted = [...played].sort();
  let best = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && dayBefore(d) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const last = sorted[sorted.length - 1];
  return { last, current: run, best };
}

/** Count one verdict. Called once per accepted verdict, after the one-verdict-per-card check.
 *  R2 finding 7 and its re-review, 14 Oct 2026: the count and the day mark are
 *  one transaction (MULTI/EXEC), so a day is never counted without being marked,
 *  and the streak is read from the marked days, so no write can move it back. */
export async function recordJuryDay(judge: string, nowMs: number): Promise<JuryDay | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(nowMs);
  const tx = redis.multi();
  tx.incr(countKey(judge, day));
  tx.expire(countKey(judge, day), 48 * 3600);
  tx.sadd(daysKey(judge), day);
  tx.smembers(daysKey(judge));
  const [count, , , days] = (await tx.exec()) as [number, unknown, unknown, string[]];
  const today = Number(count);
  const streak = streakFromDays((days ?? []).map(String));
  return { date: day, today, goal: JURY_DAILY_GOAL, streak: liveStreak(streak, day), best: streak.best, goalReachedNow: today === JURY_DAILY_GOAL };
}

/** Read today's count and the live streak. Writes nothing. */
export async function getJuryDay(judge: string, nowMs: number): Promise<JuryDay | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(nowMs);
  const [count, days] = await Promise.all([redis.get(countKey(judge, day)), redis.smembers(daysKey(judge))]);
  const streak = streakFromDays((days ?? []).map(String));
  return { date: day, today: Number(count) || 0, goal: JURY_DAILY_GOAL, streak: liveStreak(streak, day), best: streak.best, goalReachedNow: false };
}
