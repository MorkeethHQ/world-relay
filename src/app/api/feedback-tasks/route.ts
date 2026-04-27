import { NextRequest, NextResponse } from "next/server";
import { getActiveFeedbackTasks, getFeedbackTemplate } from "@/lib/feedback-tasks";
import { awardPoints } from "@/lib/proof-of-favour";
import { getRedis } from "@/lib/redis";

const FEEDBACK_PREFIX = "feedback:";

export async function GET() {
  const tasks = getActiveFeedbackTasks(3);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { address, templateId, response, image } = body;

  if (!address || !templateId || (!response && !image)) {
    return NextResponse.json(
      { error: "Missing required fields: address, templateId, and response or image" },
      { status: 400 }
    );
  }

  const template = getFeedbackTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: "Unknown feedback template" }, { status: 404 });
  }

  if (template.requiresPhoto && !image) {
    return NextResponse.json({ error: "This task requires a photo" }, { status: 400 });
  }

  const redis = getRedis();
  const todayKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${FEEDBACK_PREFIX}${address}:${templateId}:${todayKey}`;

  if (redis) {
    const existing = await redis.get(dedupeKey);
    if (existing) {
      return NextResponse.json(
        { error: "You already completed this feedback task today" },
        { status: 409 }
      );
    }
  }

  const submission = {
    address,
    templateId,
    response: response || null,
    hasImage: !!image,
    submittedAt: new Date().toISOString(),
  };

  if (redis) {
    await redis.set(dedupeKey, JSON.stringify(submission), { ex: 86400 });

    const allKey = `${FEEDBACK_PREFIX}submissions`;
    await redis.lpush(allKey, JSON.stringify(submission));
    await redis.ltrim(allKey, 0, 499);
  }

  const profile = await awardPoints(address, "feedback_completed", template.pointsReward);

  return NextResponse.json({
    success: true,
    pointsEarned: template.pointsReward,
    totalPoints: profile.totalPoints,
    level: profile.level,
  });
}
