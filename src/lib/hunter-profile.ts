// THE PROFILE AS A HUNTER AND FEEDBACK GIVER (Oscar, 8 Oct 2026: "Profile should
// be more Hunter and feedbacker, how many projects, how many reviews etc.").
//
// Pure: it counts what is on record for one person and invents nothing. No level,
// no rank and no badge is made up here; a title would be a claim with no rule
// behind it. Every number is a count of accepted work:
//   reviews    accepted pieces of work for a product's campaign
//   products   different campaigns those reviews were for
//   favours    accepted favours that were not for a product
//   launched   products this person put on FAVOUR, and how many name a product
// The contribution record only holds accepted work, so every row counts.
//
// No caller in the app yet. `/look` shows it in development.

import { hasProduct } from "@/lib/campaign-draft-shape";

type Done = { campaignId: string | null; campaignLabel?: string | null; points: number; streakBonus?: number; at: string };
type Own = { status: string; productName?: string | null; productUrl?: string | null };

export type HunterProfile = {
  reviews: number;
  products: number;
  favours: number;
  points: number;
  launched: number;
  firstAt: string | null;
  latest: Array<{ label: string; at: string }>; // the last products reviewed, newest first
};

export function hunterProfile(done: Done[], own: Own[] = []): HunterProfile {
  const forProduct = done.filter((d) => !!d.campaignId);
  const sorted = [...forProduct].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const seen = new Set<string>();
  const latest: HunterProfile["latest"] = [];
  for (const d of sorted) {
    if (seen.has(d.campaignId!)) continue;
    seen.add(d.campaignId!);
    if (latest.length < 3 && d.campaignLabel) latest.push({ label: d.campaignLabel, at: d.at });
  }
  const times = done.map((d) => Date.parse(d.at)).filter(Number.isFinite);
  return {
    reviews: forProduct.length,
    products: seen.size,
    favours: done.length - forProduct.length,
    points: done.reduce((n, d) => n + (d.points || 0) + (d.streakBonus || 0), 0),
    launched: own.filter((c) => c.status === "published" && hasProduct(c)).length,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    latest,
  };
}

/** A GitHub user name in GitHub's own shape, or null. Shape only: this proves nothing about who owns it. */
export function githubNameOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(t) ? t : null;
}
