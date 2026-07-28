import type { Redis } from "@upstash/redis";

// RETENTION MATH — measured, not asserted.
//
// Every retention claim in this repo so far ("the board churns users", "the
// cap wall is the leak") has been an inference from totals. The raw material
// for the real numbers has been sitting in redis all along:
//
//   visitors:<YYYY-MM-DD>  — set of wallet addresses that signed in that day
//   reach:<YYYY-MM-DD>     — set of device client-ids that opened the app
//   events:daily:<date>    — hash of event name → count (jury_verdict,
//                            proof_submitted, task_created, cap_hit, …)
//
// This module turns those into day-over-day cohort numbers:
//   D1 return rate — of yesterday's active DEVICES, how many opened again today.
//   D7 return rate — of the devices active 7 days ago, how many are here today.
//
// WHY DEVICES AND NOT WALLETS (verified against prod, 2026-07-29): trackVisitor
// fires only inside /api/verify-identity, and sessions last 7 days — a
// returning user inside a live session never re-signs-in, so never lands in
// today's visitors set. Measured consequence: visitors:<d> ∩ visitors:<d-1>
// was ZERO for 14 straight days while device sets showed 15-39% overlap. A
// wallet-based D1 on this data is an artifact of session TTL, not retention.
// reach:<date> is written on EVERY open (PageTracker → trackReach), so it is
// the honest activity cohort. Signed-in DAU is kept as context only.
//
// Set intersections happen IN redis (SINTER/SCARD), so nothing here ever
// downloads a member list — the reader stays cheap and read-only.

export type DayRetention = {
  date: string;
  dau: number; // signed-in wallets that day (sign-in events, NOT daily actives — see above)
  reach: number; // distinct devices that opened the app
  d1Returning: number; // devices active both this day and the previous day
  d1Rate: number | null; // d1Returning / previous day's reach (null when prev reach = 0)
  d7Returning: number;
  d7Rate: number | null;
  events: Record<string, number>; // that day's funnel counts
};

export type RetentionReport = {
  from: string;
  to: string;
  days: DayRetention[];
  summary: {
    medianD1Rate: number | null;
    latestD1Rate: number | null;
    // Direction of the leak: mean of the last 3 D1 rates minus the mean of the
    // 3 before that. Negative = retention worsening.
    d1Trend: number | null;
  };
};

export function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 1000) / 1000;
}

// Mean(last `k`) − mean(previous `k`). Pure so the trend logic is testable
// without a store; null when there is not enough history to compare.
export function trend(rates: Array<number | null>, k = 3): number | null {
  const usable = rates.filter((r): r is number => r !== null);
  if (usable.length < 2 * k) return null;
  const recent = usable.slice(-k);
  const before = usable.slice(-2 * k, -k);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.round((mean(recent) - mean(before)) * 1000) / 1000;
}

export function summarise(days: DayRetention[]): RetentionReport["summary"] {
  const d1s = days.map((d) => d.d1Rate);
  const usable = d1s.filter((r): r is number => r !== null);
  return {
    medianD1Rate: median(usable),
    latestD1Rate: usable.length ? usable[usable.length - 1] : null,
    d1Trend: trend(d1s),
  };
}

// The only redis surface this reader needs. Read-only by type: no set, no del,
// no write command is even callable from here.
export type RetentionReader = Pick<Redis, "scard" | "sinter" | "hgetall">;

const TRACKED_EVENTS = [
  "sign_in",
  "jury_verdict",
  "proof_submitted",
  "task_created",
  "task_claimed",
  "cap_hit",
  "board_replenished",
] as const;

export async function computeRetention(
  redis: RetentionReader,
  opts: { days?: number; now?: number } = {},
): Promise<RetentionReport> {
  const windowDays = Math.min(Math.max(opts.days ?? 14, 2), 30);
  const now = opts.now ?? Date.now();

  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    dates.push(utcDay(now - i * 86_400_000));
  }

  const days: DayRetention[] = [];
  for (const date of dates) {
    const prev = utcDay(Date.parse(date) - 86_400_000);
    const weekAgo = utcDay(Date.parse(date) - 7 * 86_400_000);

    const [dau, reach, prevReach, weekAgoReach, d1Members, d7Members, counts] = await Promise.all([
      redis.scard(`visitors:${date}`),
      redis.scard(`reach:${date}`),
      redis.scard(`reach:${prev}`),
      redis.scard(`reach:${weekAgo}`),
      redis.sinter(`reach:${date}`, `reach:${prev}`),
      redis.sinter(`reach:${date}`, `reach:${weekAgo}`),
      redis.hgetall(`events:daily:${date}`),
    ]);

    const d1Returning = Array.isArray(d1Members) ? d1Members.length : 0;
    const d7Returning = Array.isArray(d7Members) ? d7Members.length : 0;

    const events: Record<string, number> = {};
    for (const name of TRACKED_EVENTS) {
      const v = counts ? (counts as Record<string, unknown>)[name] : undefined;
      if (v !== undefined) events[name] = Number(v) || 0;
    }

    days.push({
      date,
      dau: Number(dau) || 0,
      reach: Number(reach) || 0,
      d1Returning,
      d1Rate: rate(d1Returning, Number(prevReach) || 0),
      d7Returning,
      d7Rate: rate(d7Returning, Number(weekAgoReach) || 0),
      events,
    });
  }

  return {
    from: dates[0],
    to: dates[dates.length - 1],
    days,
    summary: summarise(days),
  };
}
