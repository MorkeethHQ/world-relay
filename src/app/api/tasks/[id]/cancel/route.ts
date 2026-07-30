import { NextRequest, NextResponse } from "next/server";
import { cancelTask, getTask } from "@/lib/store";
import { refundEscrow } from "@/lib/escrow";
import { addNotification } from "@/lib/notifications-store";
import { ownershipError } from "@/lib/session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { poster } = body;

  if (!poster) {
    return NextResponse.json({ error: "Poster required" }, { status: 400 });
  }

  // Identity is a public address, so this ownership check is spoofable unless
  // the caller proves wallet control via their session cookie (see session.ts).
  const authErr = ownershipError(req, poster, Date.now());
  if (authErr) return NextResponse.json({ error: authErr }, { status: 403 });

  // CHAIN-STATE GUARD: a v2-funded task holds real USDC in the escrow contract.
  // App-state "cancelled" must never diverge from chain state, so cancel is
  // blocked until the money has exited on-chain (release by the poster, or
  // refund after the deadline — the escrow panel offers both). Unfunded v2
  // tasks (no escrowTxHash) cancel like any other.
  const existing = await getTask(id);
  if (
    existing &&
    existing.rewardType === "usdc-v2" &&
    existing.escrowTxHash &&
    !existing.settlementTx &&
    !existing.escrowV2RefundTx
  ) {
    return NextResponse.json({
      error:
        "This favour holds funded USDC on-chain. Release the payment, or reclaim it after the deadline — then it closes itself. Cancelling the listing cannot move escrowed money.",
    }, { status: 409 });
  }

  const task = await cancelTask(id, poster);
  if (!task) {
    return NextResponse.json({ error: "Cannot cancel this task" }, { status: 400 });
  }

  if (task.onChainId !== null) {
    const refundTx = await refundEscrow(task.onChainId).catch((err) => {
      console.error(`[Cancel] Refund failed for task ${id}:`, err);
      return null;
    });
    if (refundTx) {
      addNotification({
        userId: poster,
        type: "task_cancelled",
        title: "Task cancelled",
        body: `$${task.bountyUsdc} USDC refunded to your wallet.`,
        taskId: id,
      }).catch(console.error);
    }
  }

  return NextResponse.json({ task });
}
