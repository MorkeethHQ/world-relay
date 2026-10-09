// WHICH ROOMS EXIST. DESIGN-SYSTEM.md, "Talk": never an empty list, every app in
// the rail has a room. A room id is a project id as projectKind() knows it, so the
// same three kinds the project page serves: a product posted on FAVOUR
// (draft_*), a vote candidate (a word), an outside launch (hn_*).
//
// This file does the reading. The rules are in talk.ts. A room that cannot be
// named is not a room: FAVOUR writes no name for an app (DESIGN-SYSTEM rule 7).
// Outside pages go through the fence in product-fetch.ts and are kept for ten
// minutes, the same as the project route.

import { listCampaignResults, listPublishedCampaigns, getPublishedCampaign } from "@/lib/campaign-drafts";
import type { CampaignPicture } from "@/lib/campaign-picture";
import { campaignPicture } from "@/lib/campaign-picture";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { firstPage } from "@/lib/first-page";
import { fetchLaunches } from "@/lib/launch-feed";
import { pictureOf } from "@/lib/post-app";
import { fetchProduct, type FetchResult } from "@/lib/product-fetch";
import { CANDIDATES, candidateOrNull } from "@/lib/product-votes";
import { projectKind } from "@/lib/project-view";

export type Room = {
  id: string;
  name: string;
  picture: { url: string | null; icon: string | null };
  colour: string | null; // the app's own, gated by productColour() on the screen
  kind: "favour" | "vote" | "launch";
};

const KEEP_MS = 10 * 60_000;
const pages = new Map<string, { at: number; result: FetchResult }>();

async function page(url: string, now: number): Promise<FetchResult> {
  const kept = pages.get(url);
  if (kept && now - kept.at < KEEP_MS) return kept.result;
  const result = await fetchProduct(url).catch((): FetchResult => ({ ok: false, reason: "unreadable" }));
  pages.set(url, { at: result.ok ? now : now - KEEP_MS + 60_000, result });
  return result;
}

function fromPicture(p: CampaignPicture): Room["picture"] {
  return { url: p.url, icon: p.icon };
}

/** Every room, in the order of the rail: products on FAVOUR, vote candidates, outside launches. */
export async function listRooms(now: number = Date.now()): Promise<Room[]> {
  const [first, candidates] = await Promise.all([
    firstPage({
      campaigns: () => listPublishedCampaigns(50),
      results: (id) => listCampaignResults(id),
      picture: getPictureRecord,
      launches: (n) => fetchLaunches(n),
      readPage: (url) => fetchProduct(url),
    }, now),
    Promise.all(CANDIDATES.map(async (c) => ({ c, read: await page(c.url, now) }))),
  ]);
  const rooms: Room[] = [];
  const seen = new Set<string>();
  const add = (r: Room) => { if (!seen.has(r.id)) { seen.add(r.id); rooms.push(r); } };

  const colours = await Promise.all(first.top.rows.map((r) => getPictureRecord(r.id).catch(() => null)));
  first.top.rows.forEach((r, i) => {
    const p = first.pictures[r.id];
    add({ id: r.id, name: r.name, picture: p ? fromPicture(p) : { url: null, icon: null }, colour: colours[i]?.colour ?? null, kind: "favour" });
  });
  for (const { c, read } of candidates) {
    if (!read.ok || !read.proposal.name) continue;
    add({
      id: c.id, name: read.proposal.name, kind: "vote", colour: read.proposal.colour,
      picture: fromPicture(campaignPicture({ productName: read.proposal.name, productUrl: c.url, shareImage: read.proposal.image, icon: read.proposal.icon })),
    });
  }
  for (const l of first.launches) {
    const p = first.pictures[l.id];
    const kept = pages.get(l.url)?.result;
    add({ id: l.id, name: l.name, picture: p ? fromPicture(p) : { url: null, icon: null }, colour: kept && kept.ok ? kept.proposal.colour : null, kind: "launch" });
  }
  return rooms;
}

/** One room by id, or null when no app has that id. Throws when the store could not answer. */
export async function roomOf(id: unknown, now: number = Date.now()): Promise<Room | null> {
  const kind = projectKind(id);
  if (!kind || typeof id !== "string") return null;
  if (kind === "favour") {
    const campaign = await getPublishedCampaign(id);
    if (!campaign || campaign.hidden || !campaign.productName || !campaign.productUrl) return null;
    const record = await getPictureRecord(id).catch(() => null);
    return { id, name: campaign.productName, picture: fromPicture(pictureOf(record, campaign.productName, campaign.productUrl)), colour: record?.colour ?? null, kind };
  }
  if (kind === "vote") {
    const candidate = candidateOrNull(id);
    if (!candidate) return null;
    const read = await page(candidate.url, now);
    if (!read.ok || !read.proposal.name) return null;
    return {
      id, name: read.proposal.name, kind, colour: read.proposal.colour,
      picture: fromPicture(campaignPicture({ productName: read.proposal.name, productUrl: candidate.url, shareImage: read.proposal.image, icon: read.proposal.icon })),
    };
  }
  const launch = (await fetchLaunches(now)).find((l) => l.id === id);
  if (!launch) return null;
  const read = await page(launch.url, now);
  return {
    id, name: launch.name, kind, colour: read.ok ? read.proposal.colour : null,
    picture: fromPicture(campaignPicture({ productName: launch.name, productUrl: launch.url, shareImage: read.ok ? read.proposal.image : null, icon: read.ok ? read.proposal.icon : null })),
  };
}
