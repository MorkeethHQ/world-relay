import { NextRequest, NextResponse } from "next/server";
import { getPublishedCampaign, listCampaignResults } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { productView } from "@/lib/product-view";

// GET /api/product/<id> -> one product on FAVOUR, as the product screen shows it:
// its picture, what the maker asks, the reward and the task a review goes to.
// A draft, a hidden campaign and a campaign that names no product answer 404.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaign = await getPublishedCampaign(id);
    if (!campaign || campaign.hidden) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [results, record] = await Promise.all([listCampaignResults(id).catch(() => []), getPictureRecord(id).catch(() => null)]);
    const product = productView(campaign, results, record);
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ product }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ error: "This product could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
