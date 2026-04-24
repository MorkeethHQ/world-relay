import { NextRequest, NextResponse } from "next/server";
import { getTask, submitProof, completeTask } from "@/lib/store";
import { verifyProof, verifyProofStub } from "@/lib/verify-proof";
import { postProofSubmitted, postVerificationResult } from "@/lib/xmtp";
import { notifyProofSubmitted, notifyVerified, notifyFlagged } from "@/lib/notifications";
import { getRedis } from "@/lib/redis";

const RATE_LIMIT_KEY = "ratelimit:verify";
const MAX_VERIFICATIONS_PER_HOUR = 20;

async function checkRateLimit(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  const count = await redis.incr(RATE_LIMIT_KEY);
  if (count === 1) {
    await redis.expire(RATE_LIMIT_KEY, 3600);
  }
  return count <= MAX_VERIFICATIONS_PER_HOUR;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId, proofImageBase64, proofNote } = body;

  if (!taskId || !proofImageBase64) {
    return NextResponse.json({ error: "Missing taskId or proof image" }, { status: 400 });
  }

  const task = await getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.status !== "claimed") {
    return NextResponse.json({ error: "Task not in claimed state" }, { status: 400 });
  }

  await submitProof(taskId, `data:image/jpeg;base64,${proofImageBase64}`, proofNote || null);
  await postProofSubmitted(taskId, proofNote);

  const withinLimit = await checkRateLimit();
  const useRealVerification = !!process.env.ANTHROPIC_API_KEY && withinLimit;

  let result;
  try {
    result = useRealVerification
      ? await verifyProof(task.description, proofImageBase64, proofNote)
      : verifyProofStub(task.description, proofImageBase64);
  } catch (err) {
    console.error("AI verification error, falling back to stub:", err);
    result = verifyProofStub(task.description, proofImageBase64);
  }

  await completeTask(taskId, result);
  await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc, result.confidence);

  notifyProofSubmitted(task.poster, task.description).catch(console.error);
  if (result.verdict === "pass" && task.claimant) {
    notifyVerified(task.claimant, task.bountyUsdc).catch(console.error);
  } else if (result.verdict === "flag") {
    notifyFlagged(task.poster, task.description).catch(console.error);
  }

  return NextResponse.json({
    taskId,
    verification: result,
    task: await getTask(taskId),
  });
}
