// OSCAR'S OWN PROJECTS LEAD THE DECK (Oscar, 19 Oct 2026 ~17:55: "maybe its just a
// way for ME to get users, and ill gladly pay for people also checking ... my
// projects"). Only STRIVE is posted on FAVOUR today; posting the others is his
// wallet's click. Until then these seeds carry the card. When a posted project
// shares a host with a seed, the posted project wins (its id has the review path)
// and the seed only lends its line and picture.
import type { DeckCard } from "@/lib/deck-view";
import { hostOf } from "@/lib/deck-view";

export type Seed = { name: string; url: string; line: string; image: string | null };

export const OSCAR_SEEDS: Seed[] = [
  // Only projects with a public link (registry 00 Dashboard/registry.md, 19 Oct). Hipster,
  // Revival and the token tool have no public URL on record; they join when Oscar posts them.
  { name: "STRIVE", url: "https://striverun.app", line: "Post an agent run as a card people can read and share.", image: null },
  { name: "Transcripto", url: "https://pypi.org/project/transcripto", line: "Grades the prompts you typed. Install it, run it on your own sessions.", image: null },
  { name: "Oscar Labs", url: "https://oscar-labs.vercel.app", line: "One builder, every experiment written up with the receipts.", image: null },
];

export function seedCard(s: Seed): DeckCard {
  return {
    id: `seed:${hostOf(s.url)}`,
    source: "oscar",
    name: s.name,
    line: s.line,
    maker: "Oscar",
    from: "Built by Oscar",
    url: s.url,
    host: hostOf(s.url),
    image: s.image,
    foundElsewhere: false,
    projectId: null,
    yes: 0,
    of: 10,
    live: false,
    points: 0,
    usd: null,
    hnPoints: null,
    hnComments: null,
    hnUrl: null,
  };
}

/** Seeds merged with the posted list: a posted project on a seed's host takes the
 *  front spot with its own id; a seed with no posted twin stays a seed. */
export function mergeSeeds(seeds: Seed[], posted: DeckCard[]): { front: DeckCard[]; rest: DeckCard[] } {
  const front: DeckCard[] = [];
  const used = new Set<string>();
  for (const s of seeds) {
    const host = hostOf(s.url);
    const name = s.name.toLowerCase();
    // Same host, or the same name on a live project (STRIVE is posted under an older host).
    const twin = posted.find((p) => !used.has(p.id) && (p.host === host || (p.live && p.name.trim().toLowerCase() === name)));
    if (twin) {
      used.add(twin.id);
      front.push({ ...twin, source: "oscar", maker: "Oscar", from: "Built by Oscar", foundElsewhere: false, line: twin.line || s.line, image: twin.image ?? s.image });
    } else {
      front.push(seedCard(s));
    }
  }
  return { front, rest: posted.filter((p) => !used.has(p.id)) };
}
