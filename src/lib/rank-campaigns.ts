// THE TOP LIST OF THE DAY (Oscar, 8 Oct 2026: "stats and data on campaigns on the
// first page, TOP list of the day ... a place to review products and THEN ask for
// favours").
//
// Pure: it ranks the campaigns it is given by the reviews on record. It fetches
// nothing and invents nothing. A campaign with no review today still shows, with
// a zero, and the list says what it was ranked by.
//
// Order: reviews accepted in the last 24 hours, then reviews accepted in total,
// then newest first. Only a "pass" counts: a flagged or failed review never lifts
// a product. Votes can be added as a key later; voting is not built.
//
// No caller in the app yet. `/look` shows it in development.

import type { CampaignResult, PublicCompanyCampaign } from "@/lib/campaign-draft-shape";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type RankedCampaign = {
  rank: number;
  id: string;
  name: string; // the product's name, or the company's when no product is named
  company: string;
  productUrl: string | null;
  points: number; // points per accepted piece; real
  acceptedToday: number;
  acceptedTotal: number;
  reviewedTotal: number;
  publishedAt: string | null;
};

export type TopList = {
  rows: RankedCampaign[];
  products: number;
  acceptedToday: number;
  acceptedTotal: number;
  rankedBy: "today" | "total" | "newest"; // what separated the top of the list
};

type Input = {
  campaign: Pick<PublicCompanyCampaign, "id" | "company" | "productName" | "productUrl" | "rewardPerPiecePoints" | "publishedAt" | "hidden">;
  results: Array<Pick<CampaignResult, "verdict" | "at">>;
};

export function rankCampaigns(input: Input[], now: number = Date.now()): TopList {
  const rows = input
    .filter((x) => !x.campaign.hidden)
    .map(({ campaign: c, results }) => {
      const passed = results.filter((r) => r.verdict === "pass");
      const today = passed.filter((r) => {
        const t = Date.parse(r.at);
        return Number.isFinite(t) && t <= now && now - t < DAY_MS;
      });
      return {
        rank: 0,
        id: c.id,
        name: (c.productName || c.company || "").trim(),
        company: c.company,
        productUrl: c.productUrl ?? null,
        points: c.rewardPerPiecePoints,
        acceptedToday: today.length,
        acceptedTotal: passed.length,
        reviewedTotal: results.length,
        publishedAt: c.publishedAt ?? null,
      };
    })
    .sort((a, b) =>
      b.acceptedToday - a.acceptedToday ||
      b.acceptedTotal - a.acceptedTotal ||
      (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0) ||
      a.id.localeCompare(b.id),
    )
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const acceptedToday = rows.reduce((n, r) => n + r.acceptedToday, 0);
  const acceptedTotal = rows.reduce((n, r) => n + r.acceptedTotal, 0);
  return {
    rows,
    products: rows.length,
    acceptedToday,
    acceptedTotal,
    rankedBy: acceptedToday > 0 ? "today" : acceptedTotal > 0 ? "total" : "newest",
  };
}
