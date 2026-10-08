// THE PRODUCT SCREEN'S DATA, AND WHAT A REVIEW CAME BACK AS. DESIGN-SYSTEM.md,
// Flow 1, steps 2 to 4 (Oscar, 8 Oct 2026: "people need to come in and do things.
// get paid micro favours").
//
// Pure. `productView` turns a published campaign, its results and its picture
// record into what the screen shows. `reviewOutcome` turns the reply of
// /api/verify-proof into one of four end states, so the screen never guesses.

import { hasProduct, type CampaignResult, type PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import type { CampaignPicture } from "@/lib/campaign-picture";
import { pictureOf, type PictureRecord } from "@/lib/post-app";
import { RESULTS_SHOWN_MAX } from "@/lib/rank-campaigns";

export const REVIEW_MAX = 1000; // verify-proof cuts a note at this length
export const REVIEW_MIN_WORDS = 20;

export type ProductView = {
  id: string;
  name: string;
  line: string | null; // the product's own line, from its page
  ask: string; // what the maker asks, in the maker's words
  points: number; // paid for an accepted review
  productUrl: string;
  host: string;
  reviewTaskId: string | null; // null: this product takes no review now
  picture: CampaignPicture;
  accepted: number;
  acceptedIsFloor: boolean;
  makerChecked: boolean;
  company: string;
};

export function productView(
  campaign: PublicCompanyCampaign,
  results: Array<Pick<CampaignResult, "verdict">>,
  record: PictureRecord | null,
): ProductView | null {
  if (campaign.hidden || !hasProduct(campaign)) return null;
  const name = (campaign.productName || "").trim();
  const productUrl = campaign.productUrl as string;
  let host = "";
  try { host = new URL(productUrl).hostname.replace(/^www\./, ""); } catch { return null; }
  return {
    id: campaign.id,
    name,
    line: record?.line ?? null,
    ask: campaign.brief,
    points: campaign.rewardPerPiecePoints,
    productUrl,
    host,
    reviewTaskId: campaign.pieceTaskIds?.review ?? null,
    picture: pictureOf(record, name, productUrl),
    accepted: results.filter((r) => r.verdict === "pass").length,
    acceptedIsFloor: results.length >= RESULTS_SHOWN_MAX,
    makerChecked: campaign.companyChecked === true,
    company: campaign.company,
  };
}

export function reviewWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Why the review cannot be sent yet, or null. A link to a review is enough by itself. */
export function reviewReason(text: string): string | null {
  const t = text.trim();
  if (!t) return "Write your review, or paste the link to it.";
  if (t.length > REVIEW_MAX) return `Keep it under ${REVIEW_MAX} characters.`;
  if (/^https:\/\/\S+$/.test(t)) return null;
  const words = reviewWords(t);
  if (words < REVIEW_MIN_WORDS) return `Write ${REVIEW_MIN_WORDS} words or more. You have ${words}.`;
  return null;
}

export type ReviewOutcome =
  | { kind: "passed"; points: number | null } // null: the server did not say how many
  | { kind: "not_passed"; reason: string } // the check read it and said no
  | { kind: "held"; reason: string } // the check was not sure; nothing is lost
  | { kind: "problem"; text: string; signIn: boolean; again: boolean }; // nothing was judged

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function reviewOutcome(status: number, data: unknown): ReviewOutcome {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) {
    const v = (d.verification && typeof d.verification === "object" ? d.verification : {}) as Record<string, unknown>;
    const why = text(d.personTip) ?? text(v.reasoning);
    if (v.verdict === "pass") {
      return { kind: "passed", points: typeof d.pointsAwarded === "number" && Number.isFinite(d.pointsAwarded) ? d.pointsAwarded : null };
    }
    if (v.verdict === "fail") return { kind: "not_passed", reason: why ?? "The check did not accept this review." };
    if (v.verdict === "flag") return { kind: "held", reason: why ?? "The check was not sure about this review." };
    // A reply with no verdict is not a pass. Say what is known: nothing.
    return { kind: "problem", text: "FAVOUR did not get a result for this review. Look in History before you send it again.", signIn: false, again: false };
  }
  const said = text(d.message) ?? text(d.error);
  if (status === 401 || (status === 403 && d.code === "reauth_required")) {
    return { kind: "problem", text: "Sign in to send your review.", signIn: true, again: false };
  }
  if (status === 409 && d.code === "already_completed") {
    return { kind: "problem", text: said ?? "You already reviewed this product.", signIn: false, again: false };
  }
  if (status === 429 || status >= 500) {
    return { kind: "problem", text: said ?? "The check could not run. Your review was not judged. Try again.", signIn: false, again: true };
  }
  return { kind: "problem", text: said ?? "This review could not be sent.", signIn: false, again: false };
}
