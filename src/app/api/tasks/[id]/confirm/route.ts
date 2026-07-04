import { NextRequest, NextResponse } from "next/server";
import { getTask, posterConfirm } from "@/lib/store";
import { ownershipError } from "@/lib/session";
import { postVerificationResult } from "@/lib/xmtp";
import { fireWebhook } from "@/lib/webhooks";
import { notifyVerified } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";
import { recordCompletion } from "@/lib/reputation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { approved, poster } = body;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.poster !== poster) {
    return NextResponse.json({ error: "Only poster can confirm" }, { status: 403 });
  }
  // poster is a public address; require session proof of control.
  const authErr = ownershipError(req, poster, Date.now());
  if (authErr) return NextResponse.json({ error: authErr }, { status: 403 });

  // Money-lever removal (Inv 2): funded USDC NEVER moves through manual approval.
  // Manual poster-confirm was the one non-AI escrow-release path and thus the
  // spoofable theft vector. Funded tasks settle ONLY via AI verification
  // (verify-proof / dispute mediation). A flagged funded proof must be resubmitted
  // for a clean verdict, or disputed for AI mediation, or it expires and refunds.
  const taskIsFunded = task.onChainId !== null || !!task.escrowTxHash;
  if (taskIsFunded) {
    return NextResponse.json({
      error: "Funded tasks settle through verification, not manual approval. Ask the runner to resubmit clearer proof, or open a dispute for AI mediation.",
    }, { status: 400 });
  }

  const updated = await posterConfirm(id, approved);
  if (!updated) {
    return NextResponse.json({ error: "Task not in flagged state" }, { status: 400 });
  }

  if (approved) {
    await postVerificationResult(id, "pass", "Poster confirmed proof manually", task.bountyUsdc, undefined, task.rewardType);

    // Points-only path (funded tasks were rejected above). Credit the runner's
    // reputation + points; the direct verify and followup/dispute paths also
    // record completion on pass, and points review must too or approved points
    // tasks silently award nothing.
    if (task.claimant) {
      recordCompletion(
        task.claimant,
        task.bountyUsdc,
        task.verificationResult?.confidence ?? 0.75,
        task.claimantVerification || undefined,
        // Funded tasks are rejected earlier in this route, so this is always a
        // points task — never credit it as USDC.
        false
      ).catch(console.error);
      notifyVerified(task.claimant, task.bountyUsdc, task.rewardType).catch(console.error);
      addNotification({
        userId: task.claimant,
        type: "verified",
        title: "Points awarded!",
        body: `Your proof was approved. ${Math.round(task.bountyUsdc)} points awarded.`,
        taskId: id,
      }).catch(console.error);
    }
  } else {
    await postVerificationResult(id, "fail", "Poster rejected proof", task.bountyUsdc, undefined, task.rewardType);
  }

  // Fire webhook callback if registered
  const finalTask = await getTask(id);
  if (finalTask) {
    fireWebhook(finalTask).catch(console.error);
  }

  return NextResponse.json({ task: finalTask });
}
