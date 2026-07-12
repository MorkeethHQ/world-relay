import { NextRequest, NextResponse } from "next/server";
import { getActiveFeedbackTasks, getFeedbackTemplate } from "@/lib/feedback-tasks";
import { awardPoints, getProofOfFavour } from "@/lib/proof-of-favour";
import { getRedis } from "@/lib/redis";
import { ownershipError } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const FEEDBACK_PREFIX = "feedback:";

export async function GET() {
  const tasks = getActiveFeedbackTasks(3);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  // Anti-farm gate. `address` is a public body field; without these guards this
  // endpoint minted points with zero verification — up to ~120 pts/day/wallet
  // across the 7 templates (SECURITY-INVARIANTS #5: unverified proof never earns).
  // Defense: (1) IP rate-limit, (2) ownership gate (enforced when SESSION_ENFORCE
  // is on; logs spoofs meanwhile), (3) award points for at most ONE feedback task
  // per wallet per day — later submissions are still recorded but earn nothing.
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`feedback:${ip}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });

  const body = await req.json();
  const { address, templateId, response, image } = body;

  if (!address || !templateId || (!response && !image)) {
    return NextResponse.json(
      { error: "Missing required fields: address, templateId, and response or image" },
      { status: 400 }
    );
  }

  const ownErr = ownershipError(req, address, Date.now());
  if (ownErr) return NextResponse.json({ error: ownErr }, { status: 403 });

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

  // Award only for the FIRST feedback task a wallet submits each day. A per-wallet
  // once-a-day earn lock caps the faucet; further submissions are accepted (and
  // recorded) but pay 0, so the multi-template farm is dead.
  let pointsReward = template.pointsReward;
  if (redis) {
    await redis.set(dedupeKey, JSON.stringify(submission), { ex: 86400 });

    const allKey = `${FEEDBACK_PREFIX}submissions`;
    await redis.lpush(allKey, JSON.stringify(submission));
    await redis.ltrim(allKey, 0, 499);

    const earnedKey = `${FEEDBACK_PREFIX}earned:${address}:${todayKey}`;
    const firstEarnToday = await redis.set(earnedKey, "1", { nx: true, ex: 86400 });
    if (!firstEarnToday) pointsReward = 0;
  }

  const profile =
    pointsReward > 0
      ? await awardPoints(address, "feedback_completed", pointsReward)
      : await getProofOfFavour(address);

  return NextResponse.json({
    success: true,
    pointsEarned: pointsReward,
    totalPoints: profile.totalPoints,
    level: profile.level,
  });
}
