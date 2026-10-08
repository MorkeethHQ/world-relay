import { NextResponse } from "next/server";
import { listCampaignResults, listPublishedCampaigns } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { firstPage } from "@/lib/first-page";
import { fetchLaunches } from "@/lib/launch-feed";
import { fetchProduct } from "@/lib/product-fetch";

// GET /api/top -> what `TopProducts` shows: the ranked products on FAVOUR, three
// outside launches at most, and a picture for each row. Public, and cached for a
// minute, because one call reads the launch list and up to three outside pages
// through the fence in lib/product-fetch.ts. No caller chooses a link here.
export async function GET() {
  try {
    const page = await firstPage({
      campaigns: () => listPublishedCampaigns(50),
      results: (id) => listCampaignResults(id),
      picture: getPictureRecord,
      launches: (now) => fetchLaunches(now),
      readPage: (url) => fetchProduct(url),
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "The list could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
