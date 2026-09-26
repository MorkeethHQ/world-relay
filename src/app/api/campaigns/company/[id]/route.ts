import { NextRequest, NextResponse } from "next/server";
import { getPublishedCampaign, listCampaignResults } from "@/lib/campaign-drafts";
import { getCampaignFunding } from "@/lib/campaign-funding";

// GET /api/campaigns/company/<id> — one published company campaign, its pieces, and
// the reviewed work: accepted and rejected, with the reason. A draft id answers
// 404, the same as an id that does not exist.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getPublishedCampaign(id);
  // R16: an operator-hidden campaign answers 404 publicly, like a draft. It stays
  // stored, and verify-proof still resolves it for a proof already in flight.
  if (!campaign || campaign.hidden) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { campaign, results: await listCampaignResults(id), funding: await getCampaignFunding(id) },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
