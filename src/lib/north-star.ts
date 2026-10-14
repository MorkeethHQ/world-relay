// THE NORTH STAR (14 Oct 2026). Two numbers per UTC day, counted only for
// OUTSIDE people:
//
//   outsideJurors     wallets that saved at least one verdict on a live jury
//                     card that day. Practice rounds do not count.
//   completedFavours  favour completions credited that day: one per
//                     (favour, person) pair, the same pair the History row and
//                     the duplicate guard use.
//
// OUTSIDE means: a real wallet (0x + 40 hex), not a TEST DATA fixture wallet,
// and not listed in NORTH_STAR_EXCLUDE. That variable holds Oscar's own wallets
// and the operator wallet, comma separated, and lives in the deployment's
// environment only: no wallet is ever written into this repo.
//
// It replaces "users.verified" on /api/stats as the number to watch. That one
// counts verified:* records of any level, every sign-in included, and read 200
// from 30 Aug to 13 Oct (FAVOUR-VISION, 13 Oct).
//
// The day keys are written from the deploy of this file on. Before that, no
// record names a juror by day, so no earlier juror number exists.
import { after } from "next/server";
import { getRedis } from "./redis";

// scripts/review-fixture.json: every TEST DATA wallet starts with this.
export const FIXTURE_WALLET_PREFIX = "0x7e57da7a";
const WALLET_RE = /^0x[0-9a-f]{40}$/;
const KEEP_SECONDS = 400 * 86400;

export const nsJurorsKey = (day: string) => `ns:jurors:${day}`;
export const nsCompletedKey = (day: string) => `ns:completed:${day}`;
export const utcDayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The exclusion list from the environment. Pure. */
export function excludedFromEnv(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.NORTH_STAR_EXCLUDE ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean));
}

/** Whether a wallet counts as an outside person. Pure. */
export function isOutside(wallet: string, exclude: Set<string>): boolean {
  const w = String(wallet ?? "").toLowerCase();
  if (!WALLET_RE.test(w)) return false;
  if (w.startsWith(FIXTURE_WALLET_PREFIX)) return false;
  return !exclude.has(w);
}

export type NorthStarDay = { day: string; outsideJurors: number; completedFavours: number };

/** One day's numbers from that day's raw members. Pure. Completions are
 *  "<favourId>:<wallet>" members; the wallet is the part after the last colon. */
export function northStarDay(day: string, jurors: string[], completions: string[], exclude: Set<string>): NorthStarDay {
  const outsideJurors = new Set(jurors.map((j) => j.toLowerCase()).filter((j) => isOutside(j, exclude))).size;
  const completedFavours = new Set(
    completions.map((c) => c.toLowerCase()).filter((c) => isOutside(c.slice(c.lastIndexOf(":") + 1), exclude)),
  ).size;
  return { day, outsideJurors, completedFavours };
}

// A counter write must never hold up the verdict or completion it counts
// (Codex, 14 Oct 2026): it is not awaited, and it gives up after this long.
export const NOTE_DEADLINE_MS = 1500;

function inBackground(work: () => Promise<unknown>): void {
  const run = Promise.race([
    work().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, NOTE_DEADLINE_MS)),
  ]).then(() => undefined);
  // Inside a request, let the platform finish it after the answer is sent
  // (as lib/track.ts does). Outside one, it simply runs.
  try { after(() => run); } catch { /* not in a request */ }
}

/** Write side: a live verdict. Returns at once; never throws. */
export function noteJuror(judge: string, nowMs = Date.now()): void {
  const redis = getRedis();
  if (!redis || !judge) return;
  const key = nsJurorsKey(utcDayOf(nowMs));
  inBackground(async () => {
    await redis.sadd(key, judge.toLowerCase());
    await redis.expire(key, KEEP_SECONDS);
  });
}

/** Write side: a credited completion. Returns at once; never throws. */
export function noteCompleted(favourId: string, wallet: string, atMs = Date.now()): void {
  const redis = getRedis();
  if (!redis || !favourId || !wallet) return;
  const key = nsCompletedKey(utcDayOf(Number.isFinite(atMs) ? atMs : Date.now()));
  inBackground(async () => {
    await redis.sadd(key, `${favourId}:${wallet.toLowerCase()}`);
    await redis.expire(key, KEEP_SECONDS);
  });
}

/** Read side: the last `days` UTC days, newest first. Counts only, no wallet. */
export async function readNorthStar(days = 14, nowMs = Date.now(), exclude = excludedFromEnv()): Promise<NorthStarDay[]> {
  const redis = getRedis();
  if (!redis) return [];
  const out: NorthStarDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = utcDayOf(nowMs - i * 86400_000);
    const [jurors, completions] = await Promise.all([
      redis.smembers(nsJurorsKey(day)).catch(() => [] as string[]),
      redis.smembers(nsCompletedKey(day)).catch(() => [] as string[]),
    ]);
    out.push(northStarDay(day, (jurors ?? []) as string[], (completions ?? []) as string[], exclude));
  }
  return out;
}
