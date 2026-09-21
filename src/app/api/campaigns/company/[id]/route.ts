import { NextRequest, NextResponse } from "next/server";
import { getPublishedCampaign, listCampaignResults } from "@/lib/campaign-drafts";

// GET /api/campaigns/company/<id> — one published company campaign, its pieces, and
// the reviewed work: accepted and rejected, with the reason. A draft id answers
// 404, the same as an id that does not exist.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getPublishedCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { campaign, results: await listCampaignResults(id) },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
