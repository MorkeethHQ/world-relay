import { NextRequest, NextResponse } from "next/server";
import { listTasks, markSettled } from "@/lib/store";
import { releaseEscrow } from "@/lib/escrow";
import { broadcastEvent } from "@/lib/sse";
import { notifyPaymentReleased } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";
import { postSettlementConfirmation } from "@/lib/xmtp";
import { retryPendingUnlocks } from "@/lib/campaign-unlock";

// Reconciles funded "pass" tasks whose payout never confirmed on-chain.
//
// verify-proof marks a task pendingRelease=true when a verified, funded task
// fails to settle (releaseEscrow returned null — e.g. the USDC forward reverted
// or an RPC hiccup). This endpoint finds those tasks and re-runs releaseEscrow,
// which is idempotent: it never double-releases (guarded by the settle:{id}
// state in redis) and only returns a hash once the payout forward is confirmed.
//
// Auth: same CRON_SECRET bearer as the other crons. Admins can trigger it
// manually with the same secret for on-demand reconciliation.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await listTasks();
  const pending = tasks.filter(
    (t) =>
      t.pendingRelease === true &&
      t.onChainId !== null &&
      typeof t.claimant === "string" &&
      t.claimant.startsWith("0x") &&
      t.claimant.length === 42
  );

  const settled: string[] = [];
  const stillPending: string[] = [];

  for (const task of pending) {
    const forwardTx = await releaseEscrow(task.onChainId!, task.claimant).catch((err) => {
      console.error(`[Reconcile] releaseEscrow failed for task ${task.id}:`, err);
      return null;
    });

    if (!forwardTx) {
      stillPending.push(task.id);
      continue;
    }

    // Only announce a payout once we've durably cleared pendingRelease. If this
    // write fails, leave the task pending so a later run retries (releaseEscrow
    // returns the same confirmed tx, no re-pay) and the user is notified once —
    // not every hour.
    const persisted = await markSettled(task.id, forwardTx).then(() => true).catch((e) => {
      console.error(`[Reconcile] markSettled failed for ${task.id}:`, e);
      return false;
    });
    if (!persisted) {
      stillPending.push(task.id);
      continue;
    }
    settled.push(task.id);

    postSettlementConfirmation(task.id, task.bountyUsdc, forwardTx).catch(console.error);
    if (task.claimant) {
      notifyPaymentReleased(task.claimant, task.bountyUsdc).catch(console.error);
      addNotification({
        userId: task.claimant,
        type: "payment_released",
        title: "Payment released!",
        body: `$${task.bountyUsdc} USDC sent to your wallet.`,
        taskId: task.id,
      }).catch(console.error);
    }
    broadcastEvent("task:settled", {
      taskId: task.id,
      description: task.description.slice(0, 60),
      bountyUsdc: task.bountyUsdc,
      status: "completed",
    });
  }

  // Campaign unlocks whose payout broadcast was lost, reverted, or never sent.
  // tryUnlockPayout is idempotent (state + lock in redis), same discipline as
  // releaseEscrow above.
  const unlocks = await retryPendingUnlocks().catch((err) => {
    console.error("[Reconcile] retryPendingUnlocks failed:", err);
    return { retried: 0, settled: 0 };
  });

  return NextResponse.json({
    checked: pending.length,
    settled: settled.length,
    settledTaskIds: settled,
    stillPending: stillPending.length,
    stillPendingTaskIds: stillPending,
    unlockRetries: unlocks.retried,
    unlocksSettled: unlocks.settled,
    checkedAt: new Date().toISOString(),
  });
}
