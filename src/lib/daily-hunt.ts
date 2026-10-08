// TODAY'S HUNT (Oscar, 8 Oct 2026: "make it fun, gamified. a place you want to
// check the apps"). Pure rules, client-safe except for `store()`.
//
// A stamp has one meaning: the signed-in World wallet voted for an app, or sent a
// review of it that passed, today. "Today" is the UTC day. A stamp is kept on the
// server, per wallet, per day. It pays nothing, credits nothing, and is read only
// by its own wallet.
//
// Days in a row: the number of UTC days, ending today or yesterday, on which the
// wallet has at least one stamp. It is shown only when it is 2 or more. A failed
// read is null, never zero, and never a number this file made up.
//
// Fail closed, like product-votes.ts: a read that fails is unknown, a write that
// fails says "not saved".

import type { CampaignPicture } from "@/lib/campaign-picture";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";
import { getRedis } from "@/lib/redis";

export const HUNT_SIZE = 3;
export const HUNT_PREFIX = "hunt:";
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const STAMP = /^(vote|review):[A-Za-z0-9_-]{1,80}$/;
const STREAK_MAX_DAYS = 400;

/** The UTC day, "YYYY-MM-DD". */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export const stampForVote = (id: string) => `vote:${id}`;
export const stampForReview = (campaignId: string) => `review:${campaignId}`;

export function stampOrNull(v: unknown): string | null {
  return typeof v === "string" && STAMP.test(v) ? v : null;
}

const dayKey = (wallet: string, day: string) => `${HUNT_PREFIX}${wallet.toLowerCase()}:${day}`;
const daysKey = (wallet: string) => `${HUNT_PREFIX}days:${wallet.toLowerCase()}`;

export type HuntStore = {
  add: (key: string, member: string) => Promise<unknown>;
  members: (key: string) => Promise<unknown[]>;
};

function store(): HuntStore | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    add: (key, member) => redis.sadd(key, member),
    members: (key) => redis.smembers(key),
  };
}

export type StampResult = { ok: true; stamps: string[] } | { ok: false; reason: "wallet_required" | "bad_stamp" | "unavailable" };

/** One stamp for one wallet today. A repeat adds nothing and is not an error. */
export async function recordStamp(wallet: unknown, stamp: unknown, now: number, s: HuntStore | null = store()): Promise<StampResult> {
  if (typeof wallet !== "string" || !WALLET.test(wallet)) return { ok: false, reason: "wallet_required" };
  const id = stampOrNull(stamp);
  if (!id) return { ok: false, reason: "bad_stamp" };
  if (!s) return { ok: false, reason: "unavailable" };
  const day = utcDay(now);
  try {
    await s.add(dayKey(wallet, day), id);
    await s.add(daysKey(wallet), day);
    return { ok: true, stamps: strings(await s.members(dayKey(wallet, day))) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type Hunt = {
  day: string;
  stamps: string[] | null; // null: could not be read
  streak: number | null; // null: could not be read; 0 or 1 is never shown
};

/** What the signed-in wallet has stamped today and its days in a row. */
export async function readHunt(wallet: unknown, now: number, s: HuntStore | null = store()): Promise<Hunt> {
  const day = utcDay(now);
  if (typeof wallet !== "string" || !WALLET.test(wallet) || !s) return { day, stamps: null, streak: null };
  const [stamps, days] = await Promise.all([
    s.members(dayKey(wallet, day)).then(strings).catch(() => null),
    s.members(daysKey(wallet)).then(strings).catch(() => null),
  ]);
  return { day, stamps, streak: days ? streakOf(days, now) : null };
}

/** Days in a row with a stamp, ending today or yesterday. Pure. */
export function streakOf(days: readonly string[], now: number): number {
  const have = new Set(days);
  let cursor = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  if (!have.has(utcDay(cursor))) cursor -= 86_400_000; // today not yet stamped: count from yesterday
  let n = 0;
  while (n < STREAK_MAX_DAYS && have.has(utcDay(cursor))) { n += 1; cursor -= 86_400_000; }
  return n;
}

function strings(v: unknown[]): string[] {
  return v.filter((x): x is string => typeof x === "string");
}

// ---- the apps in the rail, built from what the first page already reads ----

export type HuntApp = {
  id: string;
  stamp: string | null; // null: this app cannot be stamped (an outside launch)
  kind: "favour" | "vote" | "launch";
  name: string;
  line: string | null;
  url: string;
  host: string;
  picture: string | null; // the share picture, for a tile and a stamp
  icon: string | null; // never a code host's own icon
  points: number | null; // FAVOUR's points, for a product on FAVOUR only
  source: string | null; // the outside source's name, for a launch only
  score: number | null; // the outside source's number
  votes: number | null;
  mine: boolean;
};

const CODE_HOSTS = ["github.com", "gitlab.com"];

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** A shared code host's icon says nothing about the app on it. */
export function isCodeHost(url: string): boolean {
  const h = hostOf(url);
  return CODE_HOSTS.some((c) => h === c || h.endsWith(`.${c}`));
}

function iconFor(url: string, picture: CampaignPicture | undefined): string | null {
  return isCodeHost(url) ? null : picture?.icon ?? null;
}

/** Products on FAVOUR first, then the vote candidates, then at most three outside launches. */
export function huntApps(page: FirstPage, votes: readonly VoteRow[]): HuntApp[] {
  const out: HuntApp[] = [];
  const onFavour = new Set<string>();
  for (const r of page.top.rows) {
    if (!r.productUrl) continue;
    onFavour.add(hostOf(r.productUrl));
    const p = page.pictures[r.id];
    out.push({
      id: r.id, stamp: stampForReview(r.id), kind: "favour", name: r.name, line: null, url: r.productUrl, host: hostOf(r.productUrl),
      picture: p?.url ?? null, icon: iconFor(r.productUrl, p), points: r.points, source: null, score: null, votes: null, mine: false,
    });
  }
  for (const v of votes) {
    if (onFavour.has(v.host)) continue; // its row on FAVOUR is the one that pays
    out.push({
      id: v.id, stamp: stampForVote(v.id), kind: "vote", name: v.name, line: v.line, url: v.url, host: v.host,
      picture: v.image, icon: isCodeHost(v.url) ? null : v.icon, points: null, source: null, score: null, votes: v.votes, mine: v.mine,
    });
  }
  for (const l of page.launches.slice(0, 3)) {
    const p = page.pictures[l.id];
    out.push({
      id: l.id, stamp: null, kind: "launch", name: l.name, line: l.line, url: l.url, host: hostOf(l.url),
      picture: p?.url ?? null, icon: iconFor(l.url, p), points: null, source: l.source, score: l.score, votes: null, mine: false,
    });
  }
  return out;
}

/** The status line on the card. An unknown count reads like an empty card, never as a number. */
export function huntLine(stamps: readonly string[] | null): string {
  const n = Math.min(stamps?.length ?? 0, HUNT_SIZE);
  if (n >= HUNT_SIZE) return "Card full. Back tomorrow.";
  if (n > 0) return `${n} of ${HUNT_SIZE}`;
  return `Check ${HUNT_SIZE} apps`;
}
