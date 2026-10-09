// THE PROJECT PAGE'S DATA, FOR EVERY APP IN THE RAIL. DESIGN-SYSTEM.md, Flow 3
// (9 Oct 2026: "we need a project page and feedback round too").
//
// Pure. One route, /p/<id>, serves three kinds of app, told apart by the id:
//   draft_*   a product posted on FAVOUR: the product and its feedback round
//   hn_*      an outside launch, read from the launch list
//   a word    a vote candidate from CANDIDATES in product-votes.ts
// Nothing here is private: a vote count is public, "mine" is not and stays on
// /api/votes. A count the server did not give is null, never zero.

import type { CampaignDraft, CampaignResult, PieceKind, PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import { campaignPicture, type CampaignPicture } from "@/lib/campaign-picture";
import type { Launch } from "@/lib/launch-feed";
import type { PictureRecord } from "@/lib/post-app";
import { hostOf } from "@/lib/daily-hunt";
import type { Candidate, Tally } from "@/lib/product-votes";
import { productView, type ProductView } from "@/lib/product-view";
import { RESULTS_SHOWN_MAX } from "@/lib/rank-campaigns";

export type ProjectKind = "favour" | "vote" | "launch";

/** Which kind of app an id names, by its namespace. Unknown shapes are null. */
export function projectKind(id: unknown): ProjectKind | null {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  if (id.startsWith("draft_")) return "favour";
  if (id.startsWith("hn_")) return "launch";
  return "vote";
}

// ---- the feedback round: the maker's ask and what came back ----

export type AcceptedReview = {
  participant: string; // already shortened by the server, never an address
  at: string;
  kind: PieceKind | null;
};

export type FeedbackRound = {
  ask: string;
  accepted: number; // verdict "pass" only, the rule in rank-campaigns.ts
  acceptedIsFloor: boolean; // the public list was full: shown as "30+"
  target: number | null; // the campaign's own review count, only when it holds one
  progress: string; // "N reviews in", "30+ reviews in", "N of M reviews"
  reviews: AcceptedReview[]; // newest first, as far as the public list goes
};

/** The campaign's own target, only when every piece it asked for is a review.
 *  A campaign with mixed pieces holds no single number that "N of M" can name. */
export function reviewTarget(campaign: Pick<PublicCompanyCampaign, "pieces">): number | null {
  const pieces = campaign.pieces ?? [];
  if (pieces.length !== 1 || pieces[0].kind !== "review") return null;
  const n = pieces[0].count;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function progressLine(accepted: number, isFloor: boolean, target: number | null): string {
  if (isFloor) return `${RESULTS_SHOWN_MAX}+ reviews in`;
  if (target !== null) return `${accepted} of ${target} reviews`;
  return `${accepted} ${accepted === 1 ? "review" : "reviews"} in`;
}

export function feedbackRound(campaign: Pick<PublicCompanyCampaign, "brief" | "pieces">, results: readonly CampaignResult[]): FeedbackRound {
  const passed = results.filter((r) => r.verdict === "pass");
  const accepted = passed.length;
  const acceptedIsFloor = results.length >= RESULTS_SHOWN_MAX;
  const target = reviewTarget(campaign);
  const reviews = passed
    .map((r) => ({ participant: typeof r.participant === "string" && r.participant ? r.participant : "someone", at: r.at, kind: r.kind ?? null }))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return { ask: campaign.brief, accepted, acceptedIsFloor, target, progress: progressLine(accepted, acceptedIsFloor, target), reviews };
}

// ---- the three kinds of project ----

export type FavourProject = { kind: "favour"; id: string; product: ProductView; round: FeedbackRound };
export type VoteProject = {
  kind: "vote"; id: string; name: string; line: string | null; url: string; host: string;
  picture: CampaignPicture; votes: number | null; // null: the count could not be read
};
export type LaunchProject = {
  kind: "launch"; id: string; name: string; line: string | null; url: string; host: string;
  picture: CampaignPicture; source: string; sourceUrl: string; score: number;
};
export type ProjectView = FavourProject | VoteProject | LaunchProject;

type Read = { ok: true; proposal: { name: string | null; line: string | null; image: string | null; icon: string | null } } | { ok: false; reason?: string };

export function favourProject(campaign: PublicCompanyCampaign, results: readonly CampaignResult[], record: PictureRecord | null): FavourProject | null {
  const product = productView(campaign, [...results], record);
  if (!product) return null;
  return { kind: "favour", id: campaign.id, product, round: feedbackRound(campaign, results) };
}

/** A candidate whose page gave no name is not a project: FAVOUR writes no name for it. */
export function voteProject(candidate: Candidate, read: Read | null, tally: Tally | null): VoteProject | null {
  if (!read || !read.ok || !read.proposal.name) return null;
  const name = read.proposal.name;
  return {
    kind: "vote", id: candidate.id, name, line: read.proposal.line, url: candidate.url, host: hostOf(candidate.url),
    picture: campaignPicture({ productName: name, productUrl: candidate.url, shareImage: read.proposal.image, icon: read.proposal.icon }),
    votes: tally && typeof tally.votes === "number" ? tally.votes : null,
  };
}

export function launchProject(launch: Launch, read: Read | null): LaunchProject {
  const ok = !!read && read.ok;
  return {
    kind: "launch", id: launch.id, name: launch.name, line: launch.line, url: launch.url, host: hostOf(launch.url),
    picture: campaignPicture({ productName: launch.name, productUrl: launch.url, shareImage: ok ? read.proposal.image : null, icon: ok ? read.proposal.icon : null }),
    source: launch.source, sourceUrl: launch.sourceUrl, score: launch.score,
  };
}

/** The signed-in person's own posted apps, from their own draft list. Published only. */
export function ownApps(drafts: ReadonlyArray<Pick<CampaignDraft, "id" | "status" | "productName" | "productUrl" | "publishedAt">>):Array<{ id: string; name: string; host: string; publishedAt: string | null }> {
  return drafts
    .filter((d) => (d.status === "published" || d.status === "publishing") && !!d.productName && !!d.productUrl)
    .map((d) => ({ id: d.id, name: (d.productName as string).trim(), host: hostOf(d.productUrl as string), publishedAt: d.publishedAt ?? null }))
    .sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
}
