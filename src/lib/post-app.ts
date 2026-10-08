// POST YOUR OWN APP (Oscar, 8 Oct 2026: "someone should post their own app", then
// "build post hyour app"). DESIGN-SYSTEM.md, Flow 2.
//
// A maker pastes a link, confirms what FAVOUR read from the page, writes what
// they ask of a reviewer, and publishes. This file is the pure part: it turns
// those few answers into the body the existing draft rules accept, and it builds
// the picture record. It saves nothing and fetches nothing.
//
// Four taps means defaults. The maker does not choose a kind of work, a count, a
// reward or a pool here: a posted app asks for reviews, ten of them, at ten
// points each. No pool is proposed. Funding is a separate, later step.

import { MIN_BRIEF_WORDS, briefWords, productNameOrNull } from "@/lib/campaign-draft-shape";
import { campaignPicture, pictureAllowsLaunch, safePicture, type CampaignPicture } from "@/lib/campaign-picture";
import { fetchableUrl, type ProductProposal } from "@/lib/product-fetch";

export const POST_REVIEWS = 10;
export const POST_POINTS = 10;
export const ASK_MAX = 500;

export type PostInput = { productUrl: unknown; productName: unknown; ask: unknown; makerImage?: unknown };

/** The link as a posted app may have it: the same https-only shape the page reader accepts. */
export function postUrlOrNull(v: unknown): string | null {
  return fetchableUrl(v)?.toString() ?? null;
}

/** The body for validateDraftInput. Only these fields; nothing about money. */
export function postBody(input: PostInput) {
  const productName = productNameOrNull(input.productName);
  return {
    company: productName ?? "",
    productName: productName ?? "",
    productUrl: postUrlOrNull(input.productUrl) ?? "",
    brief: typeof input.ask === "string" ? input.ask.replace(/\s+/g, " ").trim().slice(0, ASK_MAX) : "",
    pieces: [{ kind: "review" as const, count: POST_REVIEWS }],
    rewardPerPiecePoints: POST_POINTS,
    proposedPoolUsdc: 0,
    reviewRule: "ai" as const,
  };
}

/** Why the maker cannot publish yet, in the order the screen asks, or null. */
export function postReason(input: PostInput, picture: CampaignPicture): string | null {
  if (!postUrlOrNull(input.productUrl)) return "Paste a link to your app. It must start with https.";
  if (!productNameOrNull(input.productName)) return "Give your app a name.";
  const words = briefWords(typeof input.ask === "string" ? input.ask : "");
  if (words < MIN_BRIEF_WORDS) return `Say what you want people to try and tell you, in at least ${MIN_BRIEF_WORDS} words. You have ${words}.`;
  if (!pictureAllowsLaunch(picture)) return "Your app needs a picture. Add a link to one.";
  return null;
}

// What is kept beside the campaign so its card can look like the product. The
// draft type has no picture, and it is not ours to change, so this is its own
// small record. Every link is https or null. The colour is a plain hex or null;
// product-colour.ts still decides if a screen may use it.
/** A picture link on a public https host, or null. A viewer's browser will call it,
 *  so a private address, a bare address or a port is refused, like a product link. */
export function publicPicture(v: unknown): string | null {
  const safe = safePicture(v);
  return safe && fetchableUrl(safe) ? safe : null;
}

export type PictureRecord = {
  makerImage: string | null;
  shareImage: string | null;
  icon: string | null;
  colour: string | null;
  line: string | null; // the product's own line, from its page
  readAt: string;
};

export function pictureRecord(read: ProductProposal | null, makerImage: unknown, now: number): PictureRecord {
  const colour = typeof read?.colour === "string" && /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/.test(read.colour) ? read.colour : null;
  return {
    makerImage: publicPicture(makerImage),
    shareImage: publicPicture(read?.image),
    icon: publicPicture(read?.icon),
    colour,
    line: typeof read?.line === "string" ? read.line.slice(0, 160) : null,
    readAt: new Date(now).toISOString(),
  };
}

/** A stored record, checked again on the way out. Anything odd becomes null. */
export function pictureRecordOrNull(raw: unknown): PictureRecord | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const colour = typeof r.colour === "string" && /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/.test(r.colour) ? r.colour : null;
  return {
    makerImage: publicPicture(r.makerImage), shareImage: publicPicture(r.shareImage), icon: publicPicture(r.icon), colour,
    line: typeof r.line === "string" ? r.line.slice(0, 160) : null,
    readAt: typeof r.readAt === "string" ? r.readAt : "",
  };
}

export function pictureOf(record: PictureRecord | null, productName: string, productUrl: string): CampaignPicture {
  return campaignPicture({ productName, productUrl, makerImage: record?.makerImage, shareImage: record?.shareImage, icon: record?.icon });
}
