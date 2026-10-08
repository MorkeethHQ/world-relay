// PRODUCTS LAUNCHED TODAY, FROM OUTSIDE (Oscar, 8 Oct 2026: "Maybe we can fuel it
// with real data, from like github-early tools- product hunt etc? so we have some
// dynamic?").
//
// This file reads a public launch list and returns plain rows. The first source is
// "Show HN" on Hacker News: it is public, free and needs no key, and every row is
// a product a maker launched with a link. Product Hunt needs a key and GitHub
// lists code, not launches, so both wait.
//
// What a row is NOT: it is not a FAVOUR campaign. The maker did not ask FAVOUR for
// anything, so nothing here is filled in for a company, nothing can be reviewed
// for points, and the screen must say where the row came from. The score is the
// source's own number, shown with the source's name.
//
// Pure parser plus one fetch. No caller in the app yet; `/look` shows it.

import { fetchableUrl } from "@/lib/product-fetch";
import { DAY_MS } from "@/lib/rank-campaigns";

export const LAUNCH_SOURCE = "Hacker News";
export const MAX_LAUNCHES = 10;
const NAME_MAX = 40;
const LINE_MAX = 90;

export type Launch = {
  rank: number;
  id: string;
  name: string;
  line: string | null;
  url: string; // the product's own link, https only
  source: typeof LAUNCH_SOURCE;
  sourceUrl: string; // the launch post, so the number can be checked
  score: number; // the source's points
  comments: number;
  at: string;
};

function clean(text: string, max: number): string {
  const t = text.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** "Show HN: Name – one line" becomes a name and a line. */
export function splitTitle(title: string): { name: string; line: string | null } {
  const body = title.replace(/^\s*show hn\s*[:\-–—]\s*/i, "");
  const m = body.match(/^(.{2,}?)\s+[–—-]\s+(.+)$/) || body.match(/^(.{2,}?)\s*[:,]\s+(.+)$/);
  if (m && m[1].length <= NAME_MAX) return { name: clean(m[1], NAME_MAX), line: clean(m[2], LINE_MAX) || null };
  return { name: clean(body, NAME_MAX), line: null };
}

/** Rows from the source's answer. Anything without a safe product link is dropped. */
export function parseLaunches(body: unknown, now: number = Date.now()): Launch[] {
  const hits = (body as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  const seen = new Set<string>();
  const rows: Launch[] = [];
  for (const h of hits as Array<Record<string, unknown>>) {
    const url = fetchableUrl(h.url);
    const at = typeof h.created_at_i === "number" ? h.created_at_i * 1000 : NaN;
    const score = typeof h.points === "number" && h.points >= 0 ? Math.floor(h.points) : 0;
    if (!url || typeof h.title !== "string" || typeof h.objectID !== "string" || !/^\d+$/.test(h.objectID)) continue;
    if (!Number.isFinite(at) || at > now || now - at >= DAY_MS) continue; // today means the last 24 hours
    const { name, line } = splitTitle(h.title);
    if (!name) continue;
    rows.push({
      rank: 0, id: `hn_${h.objectID}`, name, line, url: url.toString(), source: LAUNCH_SOURCE,
      sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      score, comments: typeof h.num_comments === "number" ? Math.max(0, Math.floor(h.num_comments)) : 0,
      at: new Date(at).toISOString(),
    });
  }
  return rows
    .sort((a, b) => b.score - a.score || b.comments - a.comments || a.id.localeCompare(b.id))
    .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))) // one product once, its best post
    .slice(0, MAX_LAUNCHES)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Today's launches from the source. Never throws: a failure is an empty list. */
export async function fetchLaunches(now: number = Date.now(), request: typeof fetch = fetch): Promise<Launch[]> {
  const q = new URLSearchParams({
    tags: "show_hn",
    numericFilters: `created_at_i>${Math.floor((now - DAY_MS) / 1000)},points>2`,
    hitsPerPage: "100",
  });
  try {
    const res = await request(`https://hn.algolia.com/api/v1/search_by_date?${q}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    return parseLaunches(await res.json(), now);
  } catch {
    return [];
  }
}
