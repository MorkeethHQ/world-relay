// THE HALL: the leaderboard of apps on the History tab (Oscar, 9 Oct 2026: "get
// like a new product hunt early tools vibe to it", "i like the hall").
//
// Pure. It takes the same two reads the first tab takes (/api/top and
// /api/votes), merges them the way the rail does (huntApps), and makes two
// lists. "Top" is ranked by votes; accepted reviews break a tie, then the name.
// An app whose vote count the server did not give has NO rank: it is never
// placed among the ranked apps and null is never read as zero. Today only a
// vote candidate can carry a count (lib/product-votes.ts), so a product posted
// on FAVOUR and an outside launch stay unranked until a vote store exists for
// them. "New" is newest first: the posted date for a product on FAVOUR, then
// the launch list's own order, then the vote candidates in their list order
// (they carry no date). Nothing here is made up, and nothing is fetched.

import { huntApps } from "@/lib/daily-hunt";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";

export type HallApp = {
  id: string;
  kind: "favour" | "vote" | "launch";
  name: string;
  picture: string | null;
  icon: string | null;
  votes: number | null; // null: the server did not give a count
  accepted: number; // accepted reviews on FAVOUR; 0 for an app that takes none
  postedAt: string | null; // a product on FAVOUR only
  source: string | null; // an outside launch only
};

export type RankedApp = HallApp & { rank: number };

export type Hall = {
  ranked: RankedApp[]; // every app with a known count, best first, rank 1..n
  unranked: HallApp[]; // every app with no known count, in rail order
  newest: HallApp[]; // every app, newest first
  hasRanks: boolean; // false: no app has a known count, so "Top" has no ranks at all
};

export const PODIUM = 3;

export function hallApps(page: FirstPage, votes: readonly VoteRow[]): HallApp[] {
  const rows = new Map(page.top.rows.map((r) => [r.id, r]));
  return huntApps(page, votes).map((a) => {
    const row = rows.get(a.id);
    return {
      id: a.id, kind: a.kind, name: a.name, picture: a.picture, icon: a.icon,
      votes: typeof a.votes === "number" ? a.votes : null,
      accepted: row ? row.acceptedTotal : 0,
      postedAt: row?.publishedAt ?? null,
      source: a.source,
    };
  });
}

/** Votes, then accepted reviews, then the name. Only apps with a known count. */
export function rankApps(apps: readonly HallApp[]): RankedApp[] {
  return apps
    .filter((a) => typeof a.votes === "number")
    .sort((a, b) => (b.votes as number) - (a.votes as number) || b.accepted - a.accepted || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

/** Newest first: products by posted date, then launches in their own order, then the candidates. */
export function newestApps(apps: readonly HallApp[]): HallApp[] {
  const favours = apps.filter((a) => a.kind === "favour").sort((a, b) => (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0));
  return [...favours, ...apps.filter((a) => a.kind === "launch"), ...apps.filter((a) => a.kind === "vote")];
}

export function hallOf(apps: readonly HallApp[]): Hall {
  const ranked = rankApps(apps);
  const placed = new Set(ranked.map((a) => a.id));
  return { ranked, unranked: apps.filter((a) => !placed.has(a.id)), newest: newestApps(apps), hasRanks: ranked.length > 0 };
}

export function votesLabel(n: number): string {
  return `${n} ${n === 1 ? "vote" : "votes"}`;
}
