import { NextRequest, NextResponse } from "next/server";
import { setTaskCampaign } from "@/lib/store";
import { getCampaign } from "@/lib/campaigns";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Admin backfill: tag existing tasks with a campaignId (e.g. World Cup tasks
// created before campaign linking existed). Once any task carries a campaignId,
// CampaignPage switches from the legacy "show all" fallback to strict per-campaign
// scoping. Pass campaignId: null to unlink.
//
// POST { secret, campaignId, taskIds: string[] }
export async function POST(req: NextRequest) {
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const { secret, campaignId, taskIds } = body as {
    secret?: string;
    campaignId?: string | null;
    taskIds?: string[];
  };

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds must be a non-empty array" }, { status: 400 });
  }

  // null = unlink; otherwise the campaign must exist so we never point tasks at a
  // non-existent campaign.
  if (campaignId !== null && (!campaignId || !getCampaign(campaignId))) {
    return NextResponse.json({ error: "Unknown campaignId (pass null to unlink)" }, { status: 400 });
  }

  const tagged: string[] = [];
  const notFound: string[] = [];
  for (const id of taskIds) {
    const result = await setTaskCampaign(id, campaignId ?? null);
    if (result) tagged.push(id);
    else notFound.push(id);
  }

  return NextResponse.json({
    campaignId: campaignId ?? null,
    tagged: tagged.length,
    taggedTaskIds: tagged,
    notFound: notFound.length,
    notFoundTaskIds: notFound,
  });
}
