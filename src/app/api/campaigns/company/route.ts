import { NextResponse } from "next/server";
import { listPublishedCampaigns } from "@/lib/campaign-drafts";

// GET /api/campaigns/company — published company campaigns, newest first. Public:
// these are live on the board already. Drafts never appear here.
export async function GET() {
  return NextResponse.json(
    { campaigns: await listPublishedCampaigns() },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
