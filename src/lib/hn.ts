// SHOW HN AS A SOURCE (Oscar, 11 Oct 2026: "bring in hacker news"; 19 Oct: "slide
// through showing product images, and hacker news"). Server only. Reads the
// Algolia HN search for recent Show HN launches and, for each, tries the page's
// own share picture through the same pinned reader the post flow uses. Every
// read is cached by Next for ten minutes, so no cron and no store are needed
// (self serve, Oscar 19 Oct ~18:12). HN cards are data: no favour, no task.
import type { HnHit } from "@/lib/deck-view";
import { fetchProduct } from "@/lib/product-fetch";

export const HN_URL = "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=points%3E15&hitsPerPage=24";
export const HN_REVALIDATE_S = 600;
const IMAGE_MS = 4000;
const IMAGE_TTL_MS = 60 * 60 * 1000;
// One picture read per product URL per hour per server instance. No store.
const pictures = new Map<string, { image: string | null; at: number }>();

export function parseHnHits(body: unknown): HnHit[] {
  const hits = (body as { hits?: unknown[] } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const out: HnHit[] = [];
  for (const h of hits) {
    const r = h as Record<string, unknown>;
    if (typeof r.objectID !== "string" || typeof r.title !== "string") continue;
    if (!/^\s*show\s+hn/i.test(r.title)) continue;
    const url = typeof r.url === "string" && /^https:\/\//.test(r.url) ? r.url : null;
    out.push({
      objectID: r.objectID,
      title: r.title,
      url,
      author: typeof r.author === "string" ? r.author : "someone",
      points: typeof r.points === "number" ? r.points : 0,
      num_comments: typeof r.num_comments === "number" ? r.num_comments : 0,
      created_at: typeof r.created_at === "string" ? r.created_at : "",
    });
  }
  return out;
}

export async function listShowHn(): Promise<HnHit[]> {
  try {
    const r = await fetch(HN_URL, { next: { revalidate: HN_REVALIDATE_S }, headers: { accept: "application/json" } });
    if (!r.ok) return [];
    return parseHnHits(await r.json());
  } catch {
    return [];
  }
}

/** The page's own share picture, or null within IMAGE_MS. Never throws. Cached
 *  in memory for an hour so a busy deck does not hit a product site every call. */
export async function pageImage(url: string | null): Promise<string | null> {
  if (!url) return null;
  const hit = pictures.get(url);
  if (hit && Date.now() - hit.at < IMAGE_TTL_MS) return hit.image;
  const image = await readImage(url);
  pictures.set(url, { image, at: Date.now() });
  return image;
}

async function readImage(url: string): Promise<string | null> {
  try {
    const res = await Promise.race([
      fetchProduct(url),
      new Promise<{ ok: false; reason: string }>((resolve) => setTimeout(() => resolve({ ok: false, reason: "slow" }), IMAGE_MS)),
    ]);
    return res.ok ? res.proposal.image : null;
  } catch {
    return null;
  }
}
