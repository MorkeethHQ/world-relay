// WHAT THE FIRST PAGE SHOWS, BUILT ON THE SERVER. DESIGN-SYSTEM.md, Flow 1, step 1.
//
// One call gives `TopProducts` everything: the ranked products on FAVOUR, three
// outside launches at most, and a picture for each row. Each part fails alone: if
// the outside list cannot be read there are no outside rows, and if a product's
// page cannot be read its row shows its initial. Nothing is made up.

import type { CampaignResult, PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import { campaignPicture, type CampaignPicture } from "@/lib/campaign-picture";
import type { Launch } from "@/lib/launch-feed";
import { pictureOf, type PictureRecord } from "@/lib/post-app";
import type { FetchResult } from "@/lib/product-fetch";
import { rankCampaigns, type TopList } from "@/lib/rank-campaigns";

export type FirstPage = { top: TopList; launches: Launch[]; pictures: Record<string, CampaignPicture>; at: string };

export type FirstPageDeps = {
  campaigns: () => Promise<PublicCompanyCampaign[]>;
  results: (id: string) => Promise<CampaignResult[]>;
  picture: (id: string) => Promise<PictureRecord | null>;
  launches: (now: number) => Promise<Launch[]>;
  readPage: (url: string) => Promise<FetchResult>;
};

const orElse = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export async function firstPage(deps: FirstPageDeps, now: number = Date.now()): Promise<FirstPage> {
  // The list of campaigns is the one part that is not caught here. Limit:
  // listPublishedCampaigns answers an empty list when the database errors, so
  // this cannot tell "no product" from "could not read". Its owner must change that.
  const campaigns = await deps.campaigns();
  const [rows, launches] = await Promise.all([
    Promise.all(campaigns.map(async (campaign) => ({
      campaign,
      results: await orElse(deps.results(campaign.id), []),
      record: await orElse(deps.picture(campaign.id), null),
    }))),
    orElse(deps.launches(now), []),
  ]);
  const read = await Promise.all(launches.map((l) => orElse<FetchResult | null>(deps.readPage(l.url), null)));

  const pictures: Record<string, CampaignPicture> = {};
  for (const { campaign: c, record } of rows) {
    if (c.productName && c.productUrl) pictures[c.id] = pictureOf(record, c.productName, c.productUrl);
  }
  launches.forEach((l, i) => {
    const r = read[i];
    pictures[l.id] = campaignPicture({
      productName: l.name, productUrl: l.url,
      shareImage: r?.ok ? r.proposal.image : null, icon: r?.ok ? r.proposal.icon : null,
    });
  });
  return { top: rankCampaigns(rows, now), launches, pictures, at: new Date(now).toISOString() };
}
