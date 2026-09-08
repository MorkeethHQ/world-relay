import { NextRequest, NextResponse } from "next/server";
import { getCampaignById } from "@/lib/campaign-store";
import { listTaskCompletions, listTasks } from "@/lib/store";
import { getAuthedAddress } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign?.owner) return NextResponse.json({ error: "Requester campaign not found." }, { status: 404 });
  const authed = getAuthedAddress(req, Date.now());
  if (!authed || authed.toLowerCase() !== campaign.owner.toLowerCase()) {
    return NextResponse.json({ error: "Only the verified requester can read submitted results." }, { status: 403 });
  }
  const tasks = (await listTasks()).filter((task) => task.campaignId === id);
  const completions = (await Promise.all(tasks.map((task) => listTaskCompletions(task.id)))).flat();
  return NextResponse.json({
    campaignId: id,
    cyclesCreated: tasks.length,
    verifiedCompletions: completions.length,
    completions,
  });
}
