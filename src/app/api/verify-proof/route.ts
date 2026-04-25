import { NextRequest, NextResponse } from "next/server";
import { getTask, submitProof, completeTask, setAttestationHash, setFollowUp, spawnRecurringTask } from "@/lib/store";
import { verifyProof, verifyProofConsensus, verifyProofStub } from "@/lib/verify-proof";
import type { ConsensusResult } from "@/lib/verify-proof";
import { postProofSubmitted, postVerificationResult, postFollowUpQuestion, postSettlementConfirmation, syncAndProcessMessages } from "@/lib/xmtp";
import { generateFollowUpQuestion } from "@/lib/ai-chat";
import { notifyProofSubmitted, notifyVerified, notifyFlagged } from "@/lib/notifications";
import { postAttestation } from "@/lib/attestation";
import { recordCompletion, recordFailure, getReputation, getTrustScore, getVerificationMultiplier } from "@/lib/reputation";
import { getRedis } from "@/lib/redis";
import { fireWebhook } from "@/lib/webhooks";
import { releaseEscrow, resolveDon } from "@/lib/escrow";
import { broadcastEvent } from "@/lib/sse";

const RATE_LIMIT_KEY = "ratelimit:verify";
const MAX_VERIFICATIONS_PER_HOUR = 100;

async function checkRateLimit(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  try {
    const count = await redis.incr(RATE_LIMIT_KEY);
    if (count === 1) {
      await redis.expire(RATE_LIMIT_KEY, 3600);
    }
    return count <= MAX_VERIFICATIONS_PER_HOUR;
  } catch (err) {
    console.error("[RateLimit] Redis error, allowing request:", err);
    return true;
  }
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
  const { taskId, proofImageBase64, proofNote, lat, lng, proofVideoFrame } = body;
  const demoMode = req.nextUrl.searchParams.get("demo") === "true";

  // Accept proofImages array, fall back to single proofImageBase64
  let proofImages: string[] = body.proofImages || [];
  if (proofImages.length === 0 && proofImageBase64) {
    proofImages = [proofImageBase64];
  }
  // Append video frame if provided
  if (proofVideoFrame && proofImages.length < 3) {
    proofImages.push(proofVideoFrame);
  }
  // Limit to max 3 images
  proofImages = proofImages.slice(0, 3);

  if (!taskId || proofImages.length === 0) {
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

  const proofImageUrls = proofImages.map((img: string) => `data:image/jpeg;base64,${img}`);
  await submitProof(taskId, proofImageUrls[0], proofNote || null, proofImageUrls);
  await postProofSubmitted(taskId, proofNote);

  broadcastEvent("task:proof", {
    taskId,
    description: task.description.slice(0, 60),
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    status: "claimed",
    agentName: task.agent?.name,
    timestamp: new Date().toISOString(),
  });

  const withinLimit = await checkRateLimit();
  const useRealVerification = !!process.env.ANTHROPIC_API_KEY && withinLimit;
  const useConsensus = useRealVerification && !!process.env.OPENROUTER_API_KEY;

  let result: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number; models?: Array<{ name: string; verdict: "pass" | "flag" | "fail"; confidence: number; reasoning: string }>; consensusMethod?: "majority" | "unanimous" };
  let consensusResult: ConsensusResult | null = null;
  try {
    if (useConsensus) {
      consensusResult = await verifyProofConsensus(task.description, proofImages, proofNote, task.category, task.agent?.id);
      result = {
        verdict: consensusResult.verdict,
        reasoning: consensusResult.reasoning,
        confidence: consensusResult.confidence,
        models: consensusResult.models,
        consensusMethod: consensusResult.consensusMethod,
      };
    } else if (useRealVerification) {
      result = await verifyProof(task.description, proofImages, proofNote, task.category, task.agent?.id);
    } else {
      result = verifyProofStub(task.description, proofImages[0]);
    }
  } catch (err) {
    console.error("AI verification error, falling back to stub:", err);
    result = verifyProofStub(task.description, proofImages[0]);
  }


  // Append claimant verification level and trust score to reasoning
  if (task.claimant) {
    const claimantRep = await getReputation(task.claimant);
    const claimantTrust = Math.round(getTrustScore(claimantRep) * 100);
    const vLevel = task.claimantVerification || claimantRep.verificationLevel || "wallet";
    const levelLabel = vLevel === "orb" ? "orb-level" : vLevel === "device" ? "device-level" : "wallet-level";
    const multiplier = getVerificationMultiplier(vLevel);
    const multiplierNote = multiplier > 1 ? ` (${multiplier}x multiplier)` : "";
    result = {
      ...result,
      reasoning: `${result.reasoning} | Verified by ${levelLabel} human${multiplierNote} (trust score: ${claimantTrust})`,
    };
  }

  const isFollowUpCandidate = result.verdict === "flag" && result.confidence >= 0.6 && result.confidence <= 0.85;

  if (isFollowUpCandidate && useRealVerification) {
    await completeTask(taskId, result);

    const followUpQ = await generateFollowUpQuestion(task, proofImages[0], {
      reasoning: result.reasoning,
      confidence: result.confidence,
    }).catch(() => null);

    if (followUpQ) {
      await setFollowUp(taskId, followUpQ, result.confidence);
      await postFollowUpQuestion(taskId, followUpQ, result.confidence);
    } else {
      await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc, result.confidence);
      notifyFlagged(task.poster, task.description).catch(console.error);
    }
  } else {
    await completeTask(taskId, result);
    await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc, result.confidence);

    if (result.verdict === "pass" && task.claimant) {
      notifyVerified(task.claimant, task.bountyUsdc).catch(console.error);
    } else if (result.verdict === "flag") {
      notifyFlagged(task.poster, task.description).catch(console.error);
    }
  }

  notifyProofSubmitted(task.poster, task.description).catch(console.error);

  if (task.claimant) {
    if (result.verdict === "pass") {
      recordCompletion(task.claimant, task.bountyUsdc, result.confidence, task.claimantVerification || undefined).catch(console.error);
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
      proofImages[0].slice(0, 100),
      result.verdict,
      result.confidence
    ).catch(() => null);
    if (attestationTxHash) {
      await setAttestationHash(taskId, attestationTxHash);
    }
  }

  // Auto-release escrow when verdict is pass and task has on-chain ID
  let escrowReleaseTxHash: string | null = null;
  if (result.verdict === "pass" && task.onChainId !== null) {
    escrowReleaseTxHash = await releaseEscrow(task.onChainId).catch((err) => {
      console.error("[Escrow] Auto-release failed:", err);
      return null;
    });
    if (escrowReleaseTxHash) {
      console.log(`[Escrow] Auto-released $${task.bountyUsdc} USDC for task ${taskId}: ${escrowReleaseTxHash}`);
      postSettlementConfirmation(taskId, task.bountyUsdc, escrowReleaseTxHash).catch(console.error);
    }
  }

  // Auto-resolve Double-or-Nothing when task has DON on-chain ID
  let donResolveTxHash: string | null = null;
  if (task.taskType === "double-or-nothing" && task.donOnChainId !== null) {
    const verified = result.verdict === "pass";
    donResolveTxHash = await resolveDon(task.donOnChainId, verified).catch((err) => {
      console.error("[DoN] Auto-resolve failed:", err);
      return null;
    });
    if (donResolveTxHash) {
      const winner = verified ? "runner" : "poster";
      console.log(`[DoN] Resolved task ${taskId} (${winner} wins $${task.bountyUsdc * 2}): ${donResolveTxHash}`);
      postSettlementConfirmation(taskId, task.bountyUsdc * 2, donResolveTxHash).catch(console.error);
    }
  }

  // Spawn next recurring task if applicable
  let nextRecurringTaskId: string | null = null;
  if (result.verdict === "pass") {
    const updatedTask = await getTask(taskId);
    if (updatedTask?.recurring) {
      const next = spawnRecurringTask(updatedTask);
      if (next) nextRecurringTaskId = next.id;
    }
  }

  // Fire webhook callback if registered
  const finalTask = await getTask(taskId);
  if (finalTask) {
    fireWebhook(finalTask).catch(console.error);
  }

  broadcastEvent("task:verified", {
    taskId,
    description: task.description.slice(0, 60),
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    status: finalTask?.status || "completed",
    agentName: task.agent?.name,
    verdict: result.verdict,
    confidence: result.confidence,
    timestamp: new Date().toISOString(),
  });

  syncAndProcessMessages().catch(console.error);

  return NextResponse.json({
    taskId,
    verification: result,
    consensus: consensusResult
      ? {
          models: consensusResult.models,
          consensusMethod: consensusResult.consensusMethod,
        }
      : null,
    attestationTxHash,
    escrowReleaseTxHash,
    donResolveTxHash,
    locationVerified,
    distanceKm: distanceKm !== null ? Math.round(distanceKm * 100) / 100 : null,
    nextRecurringTaskId,
    task: finalTask,
  });
}
