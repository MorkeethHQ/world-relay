// WHICH PICTURE A CAMPAIGN SHOWS (Oscar, 8 Oct 2026: "Nice pictures, UX, UI from
// apps"). A campaign should look like its product. This file only decides, from
// what is on record, which picture leads and says where it came from. It fetches
// nothing and stores nothing, and no route or component calls it yet.
//
// Order, strongest first:
//   1. the maker's own picture: the maker's word wins over anything we fetched
//   2. a capture of the live product at phone width
//   3. the share picture the product's page declares
//   4. none: a designed fallback built from the name. Never a stock picture and
//      never a picture from another product.
// Every picture carries its source, so the screen can say "from the product's
// site" or "added by the maker" and never passes a fetched picture off as ours.

export type PictureSource = "maker" | "capture" | "share" | "none";

export type CampaignPictureInput = {
  productName?: string | null;
  productUrl?: string | null;
  makerImage?: string | null;
  captureImage?: string | null;
  shareImage?: string | null;
  icon?: string | null;
};

export type CampaignPicture = {
  source: PictureSource;
  url: string | null; // null only when source is "none"
  icon: string | null;
  credit: string; // one plain line for the screen
  fallback: { initial: string; hue: number } | null; // set only when source is "none"
};

/** An https picture link with no login part, or null. */
export function safePicture(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function host(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    return new URL(v).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A steady colour angle from a name, so one product always gets the same fallback. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function campaignPicture(input: CampaignPictureInput): CampaignPicture {
  const icon = safePicture(input.icon);
  const site = host(input.productUrl);
  const maker = safePicture(input.makerImage);
  if (maker) return { source: "maker", url: maker, icon, credit: "Picture added by the maker", fallback: null };
  const capture = safePicture(input.captureImage);
  if (capture) {
    return { source: "capture", url: capture, icon, credit: site ? `The live product at ${site}` : "The live product", fallback: null };
  }
  const share = safePicture(input.shareImage);
  if (share) {
    return { source: "share", url: share, icon, credit: site ? `From ${site}` : "From the product's site", fallback: null };
  }
  const name = (input.productName || "").trim();
  const first = Array.from(name)[0];
  return {
    source: "none", url: null, icon, credit: "No picture yet",
    fallback: { initial: first ? first.toUpperCase() : "?", hue: hueOf(name) },
  };
}
