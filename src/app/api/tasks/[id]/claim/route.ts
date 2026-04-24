import { NextRequest, NextResponse } from "next/server";
import { claimTask, getTask } from "@/lib/store";
import { postClaimNotification } from "@/lib/xmtp";
import { notifyTaskClaimed } from "@/lib/notifications";
import { getRedis } from "@/lib/redis";

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
  const raw = await redis.get(`verified:${address}`);
  if (!raw) return "wallet";
  const data = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
  return data.verificationLevel || "wallet";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { claimant } = body;

  if (!claimant) {
    return NextResponse.json({ error: "Missing claimant" }, { status: 400 });
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!claimant.startsWith("dev_")) {
    const userLevel = await getUserVerificationLevel(claimant);
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

  const updated = await claimTask(id, claimant);
  if (!updated) {
    return NextResponse.json({ error: "Cannot claim task" }, { status: 400 });
  }

  await postClaimNotification(updated, claimant);
  notifyTaskClaimed(updated.poster, updated.description).catch(console.error);

  return NextResponse.json({ task: updated });
}
