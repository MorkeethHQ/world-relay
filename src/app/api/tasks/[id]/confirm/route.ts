import { NextRequest, NextResponse } from "next/server";
import { getTask, posterConfirm, markSettled, markSettlementPending } from "@/lib/store";
import { postVerificationResult, postSettlementConfirmation } from "@/lib/xmtp";
import { fireWebhook } from "@/lib/webhooks";
import { releaseEscrow } from "@/lib/escrow";
import { notifyPaymentReleased, notifyVerified } from "@/lib/notifications";
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

  const updated = await posterConfirm(id, approved);
  if (!updated) {
    return NextResponse.json({ error: "Task not in flagged state" }, { status: 400 });
  }

  if (approved) {
    await postVerificationResult(id, "pass", "Poster confirmed proof manually", task.bountyUsdc);

    // Credit the runner's reputation + points. The direct verify path (and the
    // followup/dispute resolution paths) record completion on pass; this
    // manual-approve path must too, or every flagged-then-approved task — which
    // includes all points tasks routed through review — silently awards nothing.
    if (task.claimant) {
      recordCompletion(
        task.claimant,
        task.bountyUsdc,
        task.verificationResult?.confidence ?? 0.75,
        task.claimantVerification || undefined
      ).catch(console.error);
      notifyVerified(task.claimant, task.bountyUsdc, task.rewardType).catch(console.error);
      // Points tasks have no escrow release below, so send their award notice here.
      if (task.rewardType === "points") {
        addNotification({
          userId: task.claimant,
          type: "verified",
          title: "Points awarded!",
          body: `Your proof was approved. ${Math.round(task.bountyUsdc)} points awarded.`,
          taskId: id,
        }).catch(console.error);
      }
    }

    // Poster approved a flagged proof on a funded on-chain task: release escrow now.
    // releaseEscrow is safe to call here because the contract status guard
    // (escrow.ts) rejects any task that is not Open/Claimed, preventing double-release.
    // Mirror the auto-release path (verify-proof): a confirmed hash is recorded via
    // markSettled; a null release is flagged pendingRelease so the task never reads
    // as paid and the reconcile cron retries it. Without this, a failed release on
    // this path leaves the task completed + unsettled + unretryable (stranded), and
    // even a SUCCESSFUL release never recorded its settlementTx.
    if (task.onChainId !== null) {
      const escrowTx = await releaseEscrow(task.onChainId, task.claimant).catch((err) => {
        console.error("[Escrow] Release on confirm failed:", err);
        return null;
      });
      if (escrowTx) {
        await markSettled(id, escrowTx).catch(console.error);
        postSettlementConfirmation(id, task.bountyUsdc, escrowTx).catch(console.error);
        if (task.claimant) {
          notifyPaymentReleased(task.claimant, task.bountyUsdc).catch(console.error);
          addNotification({
            userId: task.claimant,
            type: "payment_released",
            title: "Payment released!",
            body: `$${task.bountyUsdc} USDC sent to your wallet.`,
            taskId: id,
          }).catch(console.error);
        }
      } else {
        await markSettlementPending(id).catch(console.error);
        console.error(`[Escrow] Confirm-path release for task ${id} did not settle (onChainId=${task.onChainId}), flagged pendingRelease for reconcile cron`);
      }
    }
  } else {
    await postVerificationResult(id, "fail", "Poster rejected proof", task.bountyUsdc);
  }

  // Fire webhook callback if registered
  const finalTask = await getTask(id);
  if (finalTask) {
    fireWebhook(finalTask).catch(console.error);
  }

  return NextResponse.json({ task: finalTask });
}
