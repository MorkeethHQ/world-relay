import { NextRequest, NextResponse } from "next/server";
import { claimTask, getTask } from "@/lib/store";
import { postClaimNotification, postClaimBriefing, syncAndProcessMessages } from "@/lib/xmtp";
import { generateClaimBriefing } from "@/lib/ai-chat";
import { notifyTaskClaimed } from "@/lib/notifications";
import { getRedis } from "@/lib/redis";
import { broadcastEvent } from "@/lib/sse";
import { recordFavourClaimed } from "@/lib/proof-of-favour";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const VERIFICATION_TIERS: Record<string, number> = {
  orb: 3,
  device: 2,
  wallet: 1,
  dev: 0,
};

function requiredTier(bountyUsdc: number): { level: string; rank: number } {
  if (bountyUsdc >= 20) return { level: "orb", rank: 3 };
  if (bountyUsdc >= 10) return { level: "device", rank: 2 };
  return { level: "wallet", rank: 1 };
}

async function getUserVerificationLevel(address: string): Promise<string> {
  const redis = getRedis();
  if (!redis) return "wallet";
  try {
    const raw = await redis.get(`verified:${address}`);
    if (!raw) return "wallet";
    const data = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    return data.verificationLevel || "wallet";
  } catch (err) {
    console.error(`[Claim] Failed to read verification level for ${address}:`, err);
    return "wallet";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ip = getClientIp(req);
  const { ok } = rateLimit(`claim:${ip}`, 10, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json();
  const { claimant, claimCode } = body;

  if (!claimant) {
    return NextResponse.json({ error: "Missing claimant" }, { status: 400 });
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.claimCode && task.claimCode !== claimCode) {
    return NextResponse.json({
      error: "Invalid claim code",
      requiresCode: true,
      message: "This is a restricted bounty. Enter the claim code to unlock it.",
    }, { status: 403 });
  }

  if (claimant.startsWith("dev_") && task.escrowTxHash) {
    return NextResponse.json({
      error: "Dev accounts cannot claim funded tasks",
      message: "This task has real USDC escrow. Verify with World ID to claim it.",
    }, { status: 403 });
  }

  const userLevel = claimant.startsWith("dev_")
    ? "wallet"
    : await getUserVerificationLevel(claimant);

  if (!claimant.startsWith("dev_")) {
    const userRank = VERIFICATION_TIERS[userLevel] || 0;
    const required = requiredTier(task.bountyUsdc);

    if (userRank < required.rank) {
      return NextResponse.json({
        error: "Insufficient verification level",
        required: required.level,
        current: userLevel,
        message: `This task requires ${required.level} verification. Your level: ${userLevel}.`,
      }, { status: 403 });
    }
  }

  const updated = await claimTask(
    id,
    claimant,
    userLevel as "orb" | "device" | "wallet",
  );
  if (!updated) {
    return NextResponse.json({ error: "Cannot claim task" }, { status: 400 });
  }

  await postClaimNotification(updated, claimant);
  notifyTaskClaimed(updated.poster, updated.description).catch(console.error);

  // Award Proof of Favour points for claiming a task
  recordFavourClaimed(claimant).catch(console.error);

  generateClaimBriefing(updated, updated.agent?.id || undefined).then(async (briefing) => {
    if (briefing) await postClaimBriefing(updated.id, briefing);
  }).catch(console.error);

  broadcastEvent("task:claimed", {
    taskId: updated.id,
    description: updated.description.slice(0, 60),
    location: updated.location,
    bountyUsdc: updated.bountyUsdc,
    status: updated.status,
    agentName: updated.agent?.name,
    timestamp: new Date().toISOString(),
  });

  syncAndProcessMessages().catch(console.error);

  return NextResponse.json({ task: updated });
}
