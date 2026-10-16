import { getRedis } from "./redis";
import { utcDate } from "./daily";
import { excludedFromEnv, isOutside, nsJurorsKey } from "./north-star";
import { notifyJuryWaiting } from "./notifications";
import { trackEvent } from "./track";

// JURY NUDGE (17 Oct 2026). One World App notification that asks people who
// signed in before, and are not here today, to come back and judge proofs.
//
// WHY: the jury game raised swipes per head, not heads. DAU sat at 4 on 14 to
// 16 Oct and no outside juror came back the next day (jurorsBackNextDay 0 of 3,
// /api/stats northStar). The app asks for notification permission at sign-in
// (app/page.tsx), and no notification goes to past visitors today.
//
// SHIPS DARK behind JURY_NUDGE_ENFORCE (default off). Turning it on is a send to
// real people: Oscar's click. Guardrails, in order:
//   1. DEDUPE: one pass per UTC day (SET NX).
//   2. COOLDOWN: one nudge per wallet per JURY_NUDGE_COOLDOWN_DAYS (SET NX, TTL).
//   3. CAP: at most JURY_NUDGE_SEND_CAP wallets per pass.
//   4. AUDIENCE: signed-in wallets (visitors:all) that are outside per the north
//      star (no fixture wallet, nothing in NORTH_STAR_EXCLUDE), minus anyone who
//      visited or judged today.
// The number it should move: northStar outsideJurors the day of and after a send.

export const JURY_NUDGE_FLAG = "JURY_NUDGE_ENFORCE";
export const JURY_NUDGE_SEND_CAP = 300;
export const JURY_NUDGE_COOLDOWN_DAYS = 7;

export function juryNudgeEnabled(): boolean {
  return process.env[JURY_NUDGE_FLAG] === "true";
}

export type JuryNudgeResult = { enabled: boolean; deduped: boolean; audience: number; sent: number };

export async function juryNudgeAudience(date: string, exclude = excludedFromEnv()): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  const [all, visitedToday, judgedToday] = await Promise.all([
    redis.smembers("visitors:all") as Promise<string[]>,
    redis.smembers(`visitors:${date}`) as Promise<string[]>,
    redis.smembers(nsJurorsKey(date)) as Promise<string[]>,
  ]);
  const here = new Set([...(visitedToday ?? []), ...(judgedToday ?? [])].map((w) => String(w).toLowerCase()));
  const out = new Set<string>();
  for (const raw of all ?? []) {
    const w = String(raw).toLowerCase();
    if (isOutside(w, exclude) && !here.has(w)) out.add(w);
  }
  return [...out].sort();
}

export async function runJuryNudgePass(now: number): Promise<JuryNudgeResult> {
  const base: JuryNudgeResult = { enabled: juryNudgeEnabled(), deduped: false, audience: 0, sent: 0 };
  if (!base.enabled) return base;
  const redis = getRedis();
  if (!redis) return base; // no store: refuse to send rather than spam on retries
  const date = utcDate(now);
  const won = await redis.set(`jury:nudge:pass:${date}`, new Date(now).toISOString(), { nx: true, ex: 2 * 86400 });
  if (won !== "OK") return { ...base, deduped: true };

  const candidates = await juryNudgeAudience(date);
  const picked: string[] = [];
  for (const w of candidates) {
    if (picked.length >= JURY_NUDGE_SEND_CAP) break;
    const fresh = await redis.set(`jury:nudge:${w}`, date, { nx: true, ex: JURY_NUDGE_COOLDOWN_DAYS * 86400 });
    if (fresh === "OK") picked.push(w);
  }
  const sent = picked.length ? await notifyJuryWaiting(picked) : 0;
  await trackEvent("jury_nudge", { date, audience: picked.length, sent }).catch(() => {});
  return { ...base, audience: picked.length, sent };
}
