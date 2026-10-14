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
export type JuryDay = { today: number; goal: number; streak: number; best: number; goalReachedNow: boolean };

const EMPTY: JuryStreak = { last: null, current: 0, best: 0 };

/** The UTC day of a moment, as YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
}

/** The streak after a first verdict on `day`. Pure. */
export function nextStreak(prev: JuryStreak, day: string): JuryStreak {
  if (prev.last === day) return prev;
  const current = prev.last === dayBefore(day) ? prev.current + 1 : 1;
  return { last: day, current, best: Math.max(prev.best, current) };
}

/** The streak as it reads on `day`: alive if the last verdict day was today or yesterday, else 0. Pure. */
export function liveStreak(s: JuryStreak, day: string): number {
  return s.last === day || s.last === dayBefore(day) ? s.current : 0;
}

const countKey = (judge: string, day: string) => `jury:day:${judge.toLowerCase()}:${day}`;
const streakKey = (judge: string) => `jury:streak:${judge.toLowerCase()}`;

function parseStreak(raw: unknown): JuryStreak {
  if (!raw) return EMPTY;
  try {
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<JuryStreak>;
    return { last: typeof v.last === "string" ? v.last : null, current: Number(v.current) || 0, best: Number(v.best) || 0 };
  } catch {
    return EMPTY;
  }
}

/** Count one verdict. Called once per accepted verdict, after the one-verdict-per-card check. */
export async function recordJuryDay(judge: string, nowMs: number): Promise<JuryDay | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(nowMs);
  const today = Number(await redis.incr(countKey(judge, day)));
  if (today === 1) await redis.expire(countKey(judge, day), 48 * 3600).catch(() => {});
  let streak = parseStreak(await redis.get(streakKey(judge)));
  // The INCR above is the guard: only the first verdict of the day moves the streak.
  if (today === 1) {
    streak = nextStreak(streak, day);
    await redis.set(streakKey(judge), JSON.stringify(streak));
  }
  return { today, goal: JURY_DAILY_GOAL, streak: liveStreak(streak, day), best: streak.best, goalReachedNow: today === JURY_DAILY_GOAL };
}

/** Read today's count and the live streak. Writes nothing. */
export async function getJuryDay(judge: string, nowMs: number): Promise<JuryDay | null> {
  const redis = getRedis();
  if (!redis) return null;
  const day = utcDay(nowMs);
  const [count, raw] = await Promise.all([redis.get(countKey(judge, day)), redis.get(streakKey(judge))]);
  const streak = parseStreak(raw);
  return { today: Number(count) || 0, goal: JURY_DAILY_GOAL, streak: liveStreak(streak, day), best: streak.best, goalReachedNow: false };
}
