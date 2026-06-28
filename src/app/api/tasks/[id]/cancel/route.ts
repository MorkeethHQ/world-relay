import { NextRequest, NextResponse } from "next/server";
import { cancelTask } from "@/lib/store";
import { refundEscrow } from "@/lib/escrow";
import { addNotification } from "@/lib/notifications-store";

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
