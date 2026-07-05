import { NextRequest, NextResponse } from "next/server";
import { getTask, submitProof, completeTask, setAttestationHash, setFollowUp, spawnRecurringTask, markSettled, markSettlementPending } from "@/lib/store";
import { verifyProof, verifyProofConsensus, verifyProofStub } from "@/lib/verify-proof";
import type { ConsensusResult } from "@/lib/verify-proof";
import { postProofSubmitted, postVerificationResult, postFollowUpQuestion, postSettlementConfirmation, syncAndProcessMessages } from "@/lib/xmtp";
import { generateFollowUpQuestion } from "@/lib/ai-chat";
import { notifyProofSubmitted, notifyVerified, notifyFlagged, notifyPaymentReleased } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";
import { postAttestation } from "@/lib/attestation";
import { recordCompletion, recordFailure, getReputation, getTrustScore, getVerificationMultiplier } from "@/lib/reputation";
import { recordFavourAttempted, recordFavourCompleted, recordFavourFailed, completionPointsFor } from "@/lib/proof-of-favour";
import { getRedis } from "@/lib/redis";
import { fireWebhook } from "@/lib/webhooks";
import { releaseEscrow, resolveDon } from "@/lib/escrow";
import { broadcastEvent } from "@/lib/sse";
import { uploadProofImage } from "@/lib/image-upload";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { trackEvent } from "@/lib/track";
import { checkSeedCap, recordSeededEarn } from "@/lib/seed-caps";
import { tierGateError, getUserVerificationLevel } from "@/lib/verification-tier";
import { recordCampaignCompletion } from "@/lib/campaign-unlock";
import { getCampaign } from "@/lib/campaigns";
import { recordReferralActivation } from "@/lib/referral";

export const maxDuration = 60;

const RATE_LIMIT_KEY = "ratelimit:verify";

async function computeImageHash(base64: string): Promise<string> {
  const sample = base64.slice(0, 2000) + base64.slice(-2000) + base64.length.toString();
  const encoder = new TextEncoder();
  const data = encoder.encode(sample);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
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

const MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5MB per image

export async function POST(req: NextRequest) {
  // Total request body size check (20MB limit)
  const contentLength = parseInt(req.headers.get("content-length") || "0");
  if (contentLength > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const ip = getClientIp(req);
  const { ok } = await rateLimit(`verify:${ip}`, 10, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json();
  const { taskId, proofImageBase64, lat, lng, proofVideoFrame } = body;

  // Sanitize proof note
  const proofNote = body.proofNote ? sanitizeInput(body.proofNote, 1000) : undefined;
  const ADMIN_SECRET = process.env.ADMIN_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  // Demo mode only allowed outside production, or when explicitly enabled via env var
  const demoAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_MODE === "true";
  const demoMode = demoAllowed && authHeader === `Bearer ${ADMIN_SECRET}` && !!ADMIN_SECRET;
  const submitter = body.submitter;
  if (!submitter && !demoMode) {
    return NextResponse.json({ error: "Submitter identity required" }, { status: 401 });
  }

  // Prevent double-verification race condition
  const redis = getRedis();
  const verifyLock = redis && taskId ? `lock:verify:${taskId}` : null;
  if (redis && verifyLock) {
    const acquired = await redis.set(verifyLock, "1", { nx: true, px: 120000 });
    if (!acquired) {
      return NextResponse.json({ error: "Verification already in progress" }, { status: 409 });
    }
  }

  try {
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

  for (const img of proofImages) {
    if (img.length > MAX_BASE64_SIZE) {
      return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
    }
  }

  if (!taskId || (proofImages.length === 0 && !proofNote)) {
    return NextResponse.json({ error: "Missing taskId or proof (image or note)" }, { status: 400 });
  }

  // Duplicate image detection — hash first image and check if reused
  let duplicateWarning: string | null = null;
  if (proofImages.length > 0 && redis) {
    const imgHash = await computeImageHash(proofImages[0]);
    const hashKey = `proofhash:${imgHash}`;
    const existing = await redis.get(hashKey);
    if (existing && existing !== taskId) {
      duplicateWarning = `Same image was submitted for task ${existing}`;
    }
    await redis.set(hashKey, taskId, { ex: 86400 * 30 });
  }

  const task = await getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Allow direct submission from open OR claimed status
  if (task.status !== "open" && task.status !== "claimed") {
    return NextResponse.json({ error: "Task is no longer accepting submissions" }, { status: 400 });
  }
  // If already claimed by someone else, only that person can submit
  if (!demoMode && task.status === "claimed" && task.claimant && submitter !== task.claimant) {
    return NextResponse.json({ error: "Someone else is already working on this" }, { status: 403 });
  }
  // Can't submit proof for your own task
  if (submitter && task.poster === submitter) {
    return NextResponse.json({ error: "Can't submit proof for your own task" }, { status: 403 });
  }
  // Unified funded signal. A task holds real money if it has an on-chain escrow
  // id or a stored escrow tx hash. Both the safe-mode gate (below) and the
  // settlement path key off this so a funded pass is never processed silently.
  const taskIsFunded = task.onChainId !== null || !!task.escrowTxHash;

  // The submitter's verification tier, resolved once: it must travel into the
  // store on direct submission (claimantVerification feeds the campaign-unlock
  // clean gate and the trust surface — it was silently dropped here, so unlock
  // progress could never accrue via the app's main "Do it" path), and it gates
  // the consensus spend below.
  const submitterLevel = submitter ? await getUserVerificationLevel(submitter) : null;
  const claimantLevel = (task.claimantVerification || submitterLevel) as "orb" | "device" | "wallet" | null;

  // Set claimant on first submission (replaces the claim step)
  if (task.status === "open" && submitter) {
    // Daily per-wallet cap on official (seeded) tasks — enforced here because
    // direct submission is the main acquisition path, not /claim.
    const seedCap = await checkSeedCap(task, submitter);
    if (!seedCap.allowed) {
      return NextResponse.json({ error: "Daily limit reached", message: seedCap.message }, { status: 403 });
    }
    // Verification-tier gate for funded tasks. /claim enforces this, but direct
    // submission bypassed it — a wallet-level user could earn a $20 orb-only
    // bounty by skipping /claim. Only funded tasks are gated (points are not money).
    if (taskIsFunded && !demoMode) {
      const gate = await tierGateError(submitter, task.bountyUsdc);
      if (gate) {
        return NextResponse.json({
          error: "Insufficient verification level",
          required: gate.required,
          current: gate.current,
          message: `This task requires ${gate.required} verification. Your level: ${gate.current}.`,
        }, { status: 403 });
      }
    }
    task.claimant = submitter;
  }

  let locationVerified: boolean | null = null;
  let distanceKm: number | null = null;
  if (lat && lng && task.lat && task.lng) {
    distanceKm = haversineKm(Number(lat), Number(lng), task.lat, task.lng);
    locationVerified = distanceKm <= 2;
  }

  const proofImageUrls = await Promise.all(
    proofImages.map((img: string, i: number) => uploadProofImage(img, taskId, i))
  );
  await submitProof(
    taskId,
    proofImageUrls[0] || null,
    proofNote || null,
    proofImageUrls.length > 0 ? proofImageUrls : null,
    submitter,
    claimantLevel === "orb" || claimantLevel === "device" || claimantLevel === "wallet" ? claimantLevel : null
  );
  trackEvent("proof_submitted", { taskId, submitter: submitter || "", hasImages: proofImageUrls.length > 0, bounty: task.bountyUsdc }).catch(() => {});
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
  // Cost rule (Oscar, Jul 5): 3-model consensus runs ONLY where money can
  // actually move — escrow-funded tasks, and unlock-campaign tasks when the
  // claimant is Orb-verified (the unlock pays Orb only, so a non-Orb submission
  // to an unlock campaign can never move money and gets single Claude like any
  // points task). Keeps the capped OpenRouter budget ($10/mo hard limit) for
  // the verifications the pot depends on.
  const unlockCampaign = !!(task.campaignId && getCampaign(task.campaignId)?.unlock);
  const moneyAtStake = taskIsFunded || (unlockCampaign && claimantLevel === "orb");
  const useConsensus = useRealVerification && !!process.env.OPENROUTER_API_KEY && moneyAtStake;

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
      // No real AI verification available. Never award on a random verdict in
      // production — the stub (Math.random 70% pass) is dev-only. Unfunded/points
      // tasks flag for review too, so AI-generated proof can't earn by simply
      // exhausting the AI rate limit. (verifyProofStub stays for local testing.)
      if (taskIsFunded || process.env.NODE_ENV === "production") {
        result = { verdict: "flag", reasoning: "AI verification unavailable - proof requires manual review.", confidence: 0 };
      } else {
        result = verifyProofStub(task.description, proofImages[0]);
      }
    }
  } catch (err) {
    console.error("AI verification error, falling back to safe mode:", err);
    if (taskIsFunded || process.env.NODE_ENV === "production") {
      result = { verdict: "flag", reasoning: "AI verification error - proof flagged for manual review.", confidence: 0 };
    } else {
      result = verifyProofStub(task.description, proofImages[0]);
    }
  }


  // Force flag if duplicate image detected
  if (duplicateWarning && result.verdict === "pass") {
    result = { ...result, verdict: "flag", reasoning: `${result.reasoning} | WARNING: ${duplicateWarning}`, confidence: Math.min(result.confidence, 0.5) };
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
      await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc, result.confidence, task.rewardType);
      notifyFlagged(task.poster, task.description).catch(console.error);

      // In-app notification for flagged proof
      addNotification({
        userId: task.poster,
        type: "flagged",
        title: "Proof flagged",
        body: `A submission needs your review for "${task.description.slice(0, 40)}..."`,
        taskId,
      }).catch(console.error);
    }
  } else {
    await completeTask(taskId, result);
    trackEvent("verification_result", { taskId, verdict: result.verdict, confidence: result.confidence, bounty: task.bountyUsdc }).catch(() => {});
    await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc, result.confidence, task.rewardType);

    if (result.verdict === "pass" && task.claimant) {
      notifyVerified(task.claimant, task.bountyUsdc, task.rewardType).catch(console.error);

      // In-app notification for verified proof
      addNotification({
        userId: task.claimant,
        type: "verified",
        title: "Proof verified!",
        body: task.rewardType === "points"
          ? `Your proof was accepted. ${Math.round(task.bountyUsdc)} points awarded.`
          : `Your proof was accepted. $${task.bountyUsdc} USDC ready for release.`,
        taskId,
      }).catch(console.error);
    } else if (result.verdict === "flag") {
      notifyFlagged(task.poster, task.description).catch(console.error);

      addNotification({
        userId: task.poster,
        type: "flagged",
        title: "Proof flagged",
        body: `A submission needs your review for "${task.description.slice(0, 40)}..."`,
        taskId,
      }).catch(console.error);
    } else if (result.verdict === "fail" && task.claimant) {
      addNotification({
        userId: task.claimant,
        type: "proof_rejected",
        title: "Proof not accepted",
        body: `Your submission for "${task.description.slice(0, 40)}..." didn't pass. Try again with better proof.`,
        taskId,
      }).catch(console.error);
    }
  }

  notifyProofSubmitted(task.poster, task.description).catch(console.error);

  // In-app notification for proof submitted (always notify poster)
  addNotification({
    userId: task.poster,
    type: "proof_submitted",
    title: "Proof submitted",
    body: `Someone submitted proof for "${task.description.slice(0, 40)}..."`,
    taskId,
  }).catch(console.error);

  // Campaign unlock: count clean (pass + Orb) completions toward the campaign
  // threshold and pay the unlock when reached. Awaited because it can move real
  // USDC; failures land in the unlock retry set drained by the reconcile cron.
  let campaignUnlockTx: string | null = null;
  if (result.verdict === "pass" && task.claimant && task.campaignId) {
    const unlockOutcome = await recordCampaignCompletion({ ...task, verificationResult: result }).catch((err) => {
      console.error("[Unlock] recordCampaignCompletion failed:", err);
      return null;
    });
    campaignUnlockTx = unlockOutcome?.unlockTx ?? null;
    if (campaignUnlockTx && task.claimant) {
      notifyPaymentReleased(task.claimant, getCampaign(task.campaignId)?.unlock?.unlockAmount || 0).catch(console.error);
      addNotification({
        userId: task.claimant,
        type: "payment_released",
        title: "Campaign unlock!",
        body: `You completed the campaign clean — USDC sent to your wallet.`,
        taskId,
      }).catch(console.error);
    }
  }

  if (task.claimant) {
    if (result.verdict === "pass") {
      // Referral activation: the invitee's first clean completion pays the
      // referrer (points only, once, capped — see src/lib/referral.ts).
      recordReferralActivation(task.claimant).catch(console.error);
      // Count this earn against the claimant's daily seeded-task cap.
      recordSeededEarn(task, task.claimant).catch(console.error);
      // Award attempt and completion points only on a passing verdict.
      recordFavourAttempted(task.claimant).catch(console.error);
      recordCompletion(task.claimant, task.bountyUsdc, result.confidence, task.claimantVerification || undefined, taskIsFunded).catch(console.error);
      const claimantRep2 = await getReputation(task.claimant);
      // Honest pricing: a points task pays exactly its advertised bounty.
      recordFavourCompleted(
        task.claimant,
        claimantRep2.currentStreak,
        completionPointsFor(task.rewardType, task.bountyUsdc)
      ).catch(console.error);
    } else if (result.verdict === "fail") {
      recordFailure(task.claimant).catch(console.error);
      recordFavourFailed(task.claimant).catch(console.error);
    }
  }

  // Auto-release escrow (payment is the priority). A funded pass must either
  // release cleanly or clearly surface for manual review - never silent limbo.
  let escrowReleaseTxHash: string | null = null;
  let settlementNeedsReview = false;
  if (result.verdict === "pass" && taskIsFunded) {
    // Only an on-chain escrow id can be released on-chain. releaseEscrow returns
    // a hash ONLY when the payout forward is confirmed (see escrow.ts); a null
    // means settlement did not complete and is retryable.
    if (task.onChainId !== null) {
      escrowReleaseTxHash = await releaseEscrow(task.onChainId, task.claimant).catch((err) => {
        console.error("[Escrow] Auto-release failed:", err);
        return null;
      });
    }
    if (escrowReleaseTxHash) {
      // Payout confirmed on-chain: record the forward tx and clear pending flag.
      await markSettled(taskId, escrowReleaseTxHash).catch(console.error);
      postSettlementConfirmation(taskId, task.bountyUsdc, escrowReleaseTxHash).catch(console.error);
      if (task.claimant) {
        notifyPaymentReleased(task.claimant, task.bountyUsdc).catch(console.error);
        addNotification({
          userId: task.claimant,
          type: "payment_released",
          title: "Payment released!",
          body: `$${task.bountyUsdc} USDC sent to your wallet.`,
          taskId,
        }).catch(console.error);
      }
    } else {
      // Funded pass with no confirmed settlement: mark pending so the task never
      // reads as paid, and the reconciliation cron can find and retry it.
      settlementNeedsReview = true;
      await markSettlementPending(taskId).catch(console.error);
      console.error(`[Escrow] Funded pass for task ${taskId} did not settle (onChainId=${task.onChainId}), flagging for manual review`);
      notifyFlagged(task.poster, task.description).catch(console.error);
      addNotification({
        userId: task.poster,
        type: "flagged",
        title: "Payment needs review",
        body: `Verified proof for "${task.description.slice(0, 40)}..." could not auto-release payment. Manual review needed.`,
        taskId,
      }).catch(console.error);
      if (task.claimant) {
        addNotification({
          userId: task.claimant,
          type: "flagged",
          title: "Payment pending review",
          body: `Your proof for "${task.description.slice(0, 40)}..." passed but payment is pending manual review.`,
          taskId,
        }).catch(console.error);
      }
    }
  }

  // On-chain attestation (non-critical, after payment)
  let attestationTxHash: string | null = null;
  if (result.verdict === "pass" || result.verdict === "flag") {
    attestationTxHash = await postAttestation(
      taskId,
      task.description,
      (proofImages[0] || proofNote || "").slice(0, 100),
      result.verdict,
      result.confidence
    ).catch(() => null);
    if (attestationTxHash) {
      await setAttestationHash(taskId, attestationTxHash);
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
      postSettlementConfirmation(taskId, task.bountyUsdc * 2, donResolveTxHash).catch(console.error);
    }
  }

  // Spawn next recurring task if applicable
  let nextRecurringTaskId: string | null = null;
  if (result.verdict === "pass") {
    const updatedTask = await getTask(taskId);
    if (updatedTask?.recurring) {
      const next = await spawnRecurringTask(updatedTask);
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
    settlementNeedsReview,
    donResolveTxHash,
    locationVerified,
    distanceKm: distanceKm !== null ? Math.round(distanceKm * 100) / 100 : null,
    nextRecurringTaskId,
    task: finalTask,
  });
  } finally {
    if (redis && verifyLock) {
      await redis.del(verifyLock).catch(console.error);
    }
  }
}
