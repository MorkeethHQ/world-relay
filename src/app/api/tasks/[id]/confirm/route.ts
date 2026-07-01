import { NextRequest, NextResponse } from "next/server";
import { getTask, posterConfirm } from "@/lib/store";
import { postVerificationResult, postSettlementConfirmation } from "@/lib/xmtp";
import { fireWebhook } from "@/lib/webhooks";
import { releaseEscrow } from "@/lib/escrow";
import { notifyPaymentReleased } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";

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

    // Poster approved a flagged proof on a funded on-chain task: release escrow now.
    // releaseEscrow is safe to call here because the contract status guard
    // (escrow.ts) rejects any task that is not Open/Claimed, preventing double-release.
    if (task.onChainId !== null) {
      const escrowTx = await releaseEscrow(task.onChainId, task.claimant).catch((err) => {
        console.error("[Escrow] Release on confirm failed:", err);
        return null;
      });
      if (escrowTx) {
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
