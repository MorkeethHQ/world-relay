import { getRedis } from "./redis";
import {
  getPrompt,
  getStreak,
  isoWeekOf,
  listSubmitters,
  listWeekActives,
  utcDate,
} from "./daily";
import { notifyNewDaily, notifyStreakAtRisk } from "./notifications";
import { trackEvent } from "./track";

// COMEBACK NOTIFICATIONS for the daily loop — the mechanism the gate never had.
//
// SHIPS DARK. Everything here is behind DAILY_NOTIFY_ENFORCE, which defaults
// OFF (same pattern as SEED_AUTH_ENFORCE): deploying this file changes nothing
// in prod until the flag is flipped deliberately. Two passes, both driven by
// the existing daily cron (api/cron/daily-prompt):
//
//   new-daily      morning run  — "today's question is live", sent to everyone
//                                 active in the current or previous ISO week
//                                 who has not answered yet.
//   streak-at-risk evening run  — "your N-day streak ends at midnight", sent to
//                                 people who answered YESTERDAY, not today, and
//                                 have a streak worth saving.
//
// Guardrails, in order of importance:
//   1. DEDUPE: each pass fires at most once per UTC day (redis SET NX). A cron
//      retry or a second cron entry can never double-send.
//   2. CAPS: hard audience caps (below) — a bug can annoy at most CAP people.
//   3. Transport untouched: lib/notifications.ts owns the World API call and is
//      mocked in tests; nothing here fetches.

export const DAILY_NOTIFY_FLAG = "DAILY_NOTIFY_ENFORCE";
export const NEW_DAILY_AUDIENCE_CAP = 5000;
export const STREAK_RISK_CANDIDATE_CAP = 2000; // streak lookups per run
export const STREAK_RISK_SEND_CAP = 500; // messages per run
export const MIN_STREAK_WORTH_SAVING = 2;

export function dailyNotifyEnabled(): boolean {
  return process.env[DAILY_NOTIFY_FLAG] === "true";
}

export type NotifyPassResult = {
  enabled: boolean;
  pass: "new-daily" | "streak-at-risk" | "none";
  deduped: boolean;
  audience: number;
  sent: number;
};

const dedupeKey = (pass: string, date: string) => `daily:notify:${pass}:${date}`;

// True exactly once per (pass, date) — the caller that wins the SETNX owns the
// send. TTL 2 days: long enough to cover the day, short enough to self-clean.
async function winDedupe(pass: string, date: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false; // no store -> refuse to send rather than spam on retries
  const res = await redis.set(dedupeKey(pass, date), new Date().toISOString(), {
    nx: true,
    ex: 2 * 86400,
  });
  return res === "OK";
}

function previousDateOf(date: string): string {
  return utcDate(new Date(`${date}T00:00:00Z`).getTime() - 86400000);
}

// Everyone with recent proof-of-ritual (this ISO week or last) who has not yet
// answered today. Built from the survival-history sets, so the audience grows
// exactly as fast as real usage does.
export async function newDailyAudience(date: string): Promise<string[]> {
  const thisWeek = isoWeekOf(date);
  const lastWeek = isoWeekOf(utcDate(new Date(`${date}T00:00:00Z`).getTime() - 7 * 86400000));
  const [a, b, doneToday] = await Promise.all([
    listWeekActives(thisWeek),
    listWeekActives(lastWeek),
    listSubmitters(date),
  ]);
  const done = new Set(doneToday.map((x) => x.toLowerCase()));
  const audience = [...new Set([...a, ...b].map((x) => x.toLowerCase()))].filter((x) => !done.has(x));
  return audience.slice(0, NEW_DAILY_AUDIENCE_CAP);
}

export async function runNewDailyPass(now: number): Promise<NotifyPassResult> {
  const base: NotifyPassResult = { enabled: dailyNotifyEnabled(), pass: "new-daily", deduped: false, audience: 0, sent: 0 };
  if (!base.enabled) return base;
  const date = utcDate(now);
  if (!(await winDedupe("new", date))) return { ...base, deduped: true };
  const audience = await newDailyAudience(date);
  if (!audience.length) return { ...base, audience: 0 };
  const prompt = await getPrompt(date);
  const sent = await notifyNewDaily(audience, prompt.question);
  await trackEvent("daily_notify_new", { date, audience: audience.length, sent }).catch(() => {});
  return { ...base, audience: audience.length, sent };
}

// Answered yesterday, silent today, streak worth saving. Capped twice: how many
// streaks we look up, and how many messages we send.
export async function streakAtRiskAudience(date: string): Promise<Array<{ address: string; streak: number }>> {
  const yesterday = previousDateOf(date);
  const [yList, tList] = await Promise.all([listSubmitters(yesterday), listSubmitters(date)]);
  const today = new Set(tList.map((x) => x.toLowerCase()));
  const candidates = yList.map((x) => x.toLowerCase()).filter((x) => !today.has(x)).slice(0, STREAK_RISK_CANDIDATE_CAP);
  const out: Array<{ address: string; streak: number }> = [];
  const BATCH = 50;
  for (let i = 0; i < candidates.length && out.length < STREAK_RISK_SEND_CAP; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    const streaks = await Promise.all(chunk.map((a) => getStreak(a)));
    chunk.forEach((a, j) => {
      if (streaks[j] >= MIN_STREAK_WORTH_SAVING && out.length < STREAK_RISK_SEND_CAP) {
        out.push({ address: a, streak: streaks[j] });
      }
    });
  }
  return out;
}

export async function runStreakAtRiskPass(now: number): Promise<NotifyPassResult> {
  const base: NotifyPassResult = { enabled: dailyNotifyEnabled(), pass: "streak-at-risk", deduped: false, audience: 0, sent: 0 };
  if (!base.enabled) return base;
  const date = utcDate(now);
  if (!(await winDedupe("risk", date))) return { ...base, deduped: true };
  const audience = await streakAtRiskAudience(date);
  let sent = 0;
  const BATCH = 25;
  for (let i = 0; i < audience.length; i += BATCH) {
    const chunk = audience.slice(i, i + BATCH);
    const oks = await Promise.all(chunk.map(({ address, streak }) => notifyStreakAtRisk(address, streak)));
    sent += oks.filter(Boolean).length;
  }
  await trackEvent("daily_notify_risk", { date, audience: audience.length, sent }).catch(() => {});
  return { ...base, audience: audience.length, sent };
}

// Entry point for the cron. The 22:00 UTC run (2h before rollover) is the
// streak-at-risk window; any run in the first half of the day announces the
// new daily. Dedupe makes the split forgiving — a mis-scheduled cron can only
// ever fire each pass once per day.
export async function runDailyNotifyPass(now: number): Promise<NotifyPassResult> {
  if (!dailyNotifyEnabled()) return { enabled: false, pass: "none", deduped: false, audience: 0, sent: 0 };
  const hour = new Date(now).getUTCHours();
  return hour >= 18 ? runStreakAtRiskPass(now) : runNewDailyPass(now);
}
