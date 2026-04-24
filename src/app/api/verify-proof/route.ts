import { NextRequest, NextResponse } from "next/server";
import { getTask, submitProof, completeTask, setAttestationHash } from "@/lib/store";
import { verifyProof, verifyProofStub } from "@/lib/verify-proof";
import { postProofSubmitted, postVerificationResult } from "@/lib/xmtp";
import { notifyProofSubmitted, notifyVerified, notifyFlagged } from "@/lib/notifications";
import { postAttestation } from "@/lib/attestation";
import { recordCompletion, recordFailure } from "@/lib/reputation";
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId, proofImageBase64, proofNote, lat, lng } = body;

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

  let locationVerified: boolean | null = null;
  let distanceKm: number | null = null;
  if (lat && lng && task.lat && task.lng) {
    distanceKm = haversineKm(Number(lat), Number(lng), task.lat, task.lng);
    locationVerified = distanceKm <= 2;
  }

  await submitProof(taskId, `data:image/jpeg;base64,${proofImageBase64}`, proofNote || null);
  await postProofSubmitted(taskId, proofNote);

  const withinLimit = await checkRateLimit();
  const useRealVerification = !!process.env.ANTHROPIC_API_KEY && withinLimit;

  let result;
  try {
    result = useRealVerification
      ? await verifyProof(task.description, proofImageBase64, proofNote, task.category)
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

  // Track reputation
  if (task.claimant) {
    if (result.verdict === "pass") {
      recordCompletion(task.claimant, task.bountyUsdc, result.confidence).catch(console.error);
    } else if (result.verdict === "fail") {
      recordFailure(task.claimant).catch(console.error);
    }
  }

  // On-chain attestation — fire and forget
  let attestationTxHash: string | null = null;
  if (result.verdict === "pass" || result.verdict === "flag") {
    attestationTxHash = await postAttestation(
      taskId,
      task.description,
      proofImageBase64.slice(0, 100),
      result.verdict,
      result.confidence
    ).catch(() => null);
    if (attestationTxHash) {
      await setAttestationHash(taskId, attestationTxHash);
    }
  }

  return NextResponse.json({
    taskId,
    verification: result,
    attestationTxHash,
    locationVerified,
    distanceKm: distanceKm !== null ? Math.round(distanceKm * 100) / 100 : null,
    task: await getTask(taskId),
  });
}
