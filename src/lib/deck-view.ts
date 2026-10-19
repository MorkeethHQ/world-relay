// THE DECK (Oscar, 19 Oct 2026 ~18:35: "fun app, slide through showing product
// images, and hacker news"). One big card at a time. Right = try and review it,
// left = skip, with a quick reaction. Pure shapes and helpers here; the server
// side (lib/deck.ts) reads the store and Hacker News. Nothing here moves money.
//
// Three kinds of card, one shape:
//   oscar  a project Oscar built, seeded in code (lib/deck-seed.ts), leads the deck
//   posted a project a builder posted on FAVOUR (lib/projects.ts)
//   hn     a Show HN launch (lib/hn.ts): DATA ONLY (Oscar, 11 Oct 2026: "hacker
//          news is just data, they can talk about it but not do favours").
//          A right swipe on it is a reaction plus the link, never a task.

import type { ProjectCard } from "@/lib/projects-view";

export type DeckSource = "oscar" | "posted" | "hn";

export type DeckCard = {
  id: string; // project id, or hn:<objectID>
  source: DeckSource;
  name: string;
  line: string; // one line about the product
  maker: string; // who made it, plain words
  from: string; // where it came from: "Posted on FAVOUR", "Show HN", "Built by Oscar"
  url: string;
  host: string;
  image: string | null; // a real picture; null means the screen draws the funky art
  foundElsewhere: boolean; // orange banner and framed title
  // Project cards only.
  projectId: string | null;
  yes: number;
  of: number;
  live: boolean;
  points: number;
  usd: number | null; // paid slot price when the builder put USDC on it
  // Show HN only.
  hnPoints: number | null;
  hnComments: number | null;
  hnUrl: string | null; // the HN thread
};

export type Reaction = "skip" | "try" | "fire" | "meh";

export const REACTIONS: Array<{ key: Exclude<Reaction, "skip" | "try">; label: string }> = [
  { key: "fire", label: "Fire" },
  { key: "meh", label: "Meh" },
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A project from the picker as a deck card. */
export function cardFromProject(p: ProjectCard, source: Exclude<DeckSource, "hn"> = "posted", usd: number | null = null): DeckCard {
  return {
    id: p.id,
    source,
    name: p.name,
    line: p.ask,
    maker: source === "oscar" ? "Oscar" : p.fromOtherSource ? "Posted on their behalf" : "Its builder",
    from: source === "oscar" ? "Built by Oscar" : "Posted on FAVOUR",
    url: p.url,
    host: p.host,
    image: p.image,
    foundElsewhere: source === "oscar" ? false : p.fromOtherSource,
    projectId: p.id,
    yes: p.yes,
    of: p.of,
    live: p.status === "published",
    points: p.points,
    usd,
    hnPoints: null,
    hnComments: null,
    hnUrl: null,
  };
}

export type HnHit = { objectID: string; title: string; url: string | null; author: string; points: number; num_comments: number; created_at: string };

/** "Show HN: Name – one line" -> name and line. The title is the builder's own words. */
export function splitShowHnTitle(title: string): { name: string; line: string } {
  const t = title.replace(/^\s*show\s+hn\s*:\s*/i, "").trim();
  const m = t.match(/^(.{2,60}?)\s+(?:[–—-]|:|\|)\s+(.+)$/);
  if (m) return { name: m[1].trim(), line: m[2].trim() };
  return { name: t.slice(0, 60), line: t.length > 60 ? t : "" };
}

export function cardFromHn(h: HnHit, image: string | null = null): DeckCard {
  const { name, line } = splitShowHnTitle(h.title);
  const url = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`;
  return {
    id: `hn:${h.objectID}`,
    source: "hn",
    name,
    line,
    maker: h.author,
    from: "Show HN",
    url,
    host: hostOf(url),
    image,
    foundElsewhere: true,
    projectId: null,
    yes: 0,
    of: 0,
    live: false,
    points: 0,
    usd: null,
    hnPoints: h.points,
    hnComments: h.num_comments,
    hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
  };
}

/** Oscar's projects first, then posted projects (live first, as the picker sorts
 *  them), then Show HN by points. Cards already seen today go to the back, in
 *  their own order, so the deck never runs dry. */
export function orderDeck(cards: DeckCard[], seen: Set<string> = new Set()): DeckCard[] {
  const rank = (c: DeckCard) => (c.source === "oscar" ? 0 : c.source === "posted" ? 1 : 2);
  const fresh = cards.filter((c) => !seen.has(c.id));
  const old = cards.filter((c) => seen.has(c.id));
  const byRank = (a: DeckCard, b: DeckCard) => rank(a) - rank(b) || (a.source === "hn" && b.source === "hn" ? (b.hnPoints ?? 0) - (a.hnPoints ?? 0) : 0);
  return [...fresh.sort(byRank), ...old.sort(byRank)];
}

/** What the right swipe does on this card, in words. */
export function rightLabel(c: DeckCard): string {
  if (c.source === "hn") return "Looks good";
  if (!c.live) return "Try it, say YES";
  return c.usd ? `Review it, ${c.usd} USDC` : `Review it, ${c.points} pts`;
}

// STREAK (localStorage, the viewer's own count; the server never sees it). One
// day with at least one swipe keeps the streak. Dates are the viewer's local
// yyyy-mm-dd so the day turns when their day turns.
export type Streak = { days: number; last: string; today: number };

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function bumpStreak(s: Streak | null, now = new Date()): Streak {
  const today = dayKey(now);
  if (!s || !s.last) return { days: 1, last: today, today: 1 };
  if (s.last === today) return { ...s, today: s.today + 1 };
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  return { days: s.last === yesterday ? s.days + 1 : 1, last: today, today: 1 };
}

export function readStreak(raw: unknown): Streak | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.days !== "number" || typeof r.last !== "string") return null;
  return { days: r.days, last: r.last, today: typeof r.today === "number" ? r.today : 0 };
}
