import { NextRequest, NextResponse } from "next/server";
import { listTasks, markEscrowV2Refunded } from "@/lib/store";
import { getRedis } from "@/lib/redis";
import { broadcastEvent } from "@/lib/sse";
import { notifyClaimReminder } from "@/lib/notifications";
import { refundEscrow } from "@/lib/escrow";
import { refundExpiredEscrowV2, ESCROW_V2_CONFIRM_GRACE_S } from "@/lib/escrow-v2";
import { addNotification } from "@/lib/notifications-store";
import { postToThread } from "@/lib/xmtp";

const SEVEN_DAYS = 7 * 24 * 3600_000;
const FOURTEEN_DAYS = 14 * 24 * 3600_000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await listTasks();
  const now = Date.now();
  const expired: string[] = [];
  const reminded: string[] = [];
  const archived: string[] = [];
  const staleNotified: string[] = [];

  const redis = getRedis();

  const sweptV2: string[] = [];

  for (const task of tasks) {
    // Escrow-v2 abandoned-escrow safety net. The poster's own refund button is
    // the primary exit (surfaced in the task panel the moment the escrow
    // deadline passes); this sweep only fires 14 days AFTER that, so a poster
    // who wants to pay late-but-good work keeps release available for two full
    // weeks past the confirm-grace window. refund() is anyone-callable on the
    // contract and ALWAYS pays the bound funder, so the relayer key gains no
    // power here. Dark-gated: refundExpiredEscrowV2 is null while
    // ESCROW_V2_ENABLED is absent.
    if (
      task.rewardType === "usdc-v2" &&
      task.escrowTxHash &&
      !task.settlementTx &&
      !task.escrowV2RefundTx &&
      now > new Date(task.deadline).getTime() + ESCROW_V2_CONFIRM_GRACE_S * 1000 + FOURTEEN_DAYS
    ) {
      const swept = await refundExpiredEscrowV2(
        task.id,
        (task.escrowV2Address ?? undefined) as `0x${string}` | undefined
      ).catch((err) => {
        console.error(`[Cron] escrow-v2 refund sweep failed for task ${task.id}:`, err);
        return null;
      });
      if (swept) {
        await markEscrowV2Refunded(task.id, swept.txHash).catch(console.error);
        sweptV2.push(task.id);
        addNotification({
          userId: task.poster,
          type: "task_expired",
          title: "Escrow refunded",
          body: `"${task.description.slice(0, 40)}..." was never settled. $${task.bountyUsdc} USDC returned to your wallet.`,
          taskId: task.id,
        }).catch(console.error);
      }
    }

    // Claim reminders for claimed tasks without proof
    if (task.status === "claimed" && task.claimant) {
      const claimedAge = now - new Date(task.createdAt).getTime();
      const deadline = new Date(task.deadline).getTime();
      const twoHours = 2 * 3600_000;
      if (claimedAge > twoHours && deadline > now && !task.proofImageUrl) {
        const reminderKey = `reminder:${task.id}`;
        if (redis) {
          const alreadySent = await redis.get(reminderKey);
          if (!alreadySent) {
            await redis.set(reminderKey, "1", { ex: 86400 });
            notifyClaimReminder(task.claimant, task.description, task.bountyUsdc, task.rewardType).catch(console.error);
            reminded.push(task.id);
          }
        }
      }
    }

    if (task.status !== "open" && task.status !== "claimed") continue;

    const taskAge = now - new Date(task.createdAt).getTime();
    const deadline = new Date(task.deadline).getTime();

    // 14-day auto-archive: open tasks with no claims, older than 14 days
    if (task.status === "open" && !task.claimant && taskAge > FOURTEEN_DAYS) {
      task.status = "expired";
      if (redis) {
        await redis.set(`task:${task.id}`, JSON.stringify(task));
      }
      archived.push(task.id);

      // Refund escrow if funded on-chain
      if (task.onChainId !== null) {
        const refundTx = await refundEscrow(task.onChainId).catch((err) => {
          console.error(`[Cron] Refund failed for task ${task.id}:`, err);
          return null;
        });
        if (refundTx) {
          postToThread(task.id, `Task archived after 14 days with no claims. $${task.bountyUsdc} USDC refunded to creator.`).catch(console.error);
        }
      }

      // Notify creator
      addNotification({
        userId: task.poster,
        type: "task_archived",
        title: "Task archived",
        body: `"${task.description.slice(0, 40)}..." had no claims after 14 days. Funds refunded.`,
        taskId: task.id,
      }).catch(console.error);

      broadcastEvent("task:expired", {
        taskId: task.id,
        description: task.description.slice(0, 60),
      });

      continue;
    }

    // 7-day stale notification: open tasks with no claims, older than 7 days
    if (task.status === "open" && !task.claimant && taskAge > SEVEN_DAYS && taskAge <= FOURTEEN_DAYS) {
      const staleKey = `stale:${task.id}`;
      if (redis) {
        const alreadyNotified = await redis.get(staleKey);
        if (!alreadyNotified) {
          await redis.set(staleKey, "1", { ex: 7 * 86400 });
          addNotification({
            userId: task.poster,
            type: "task_stale",
            title: "Task going stale",
            body: `"${task.description.slice(0, 40)}..." has no claims after 7 days. It will be archived in ${Math.ceil((FOURTEEN_DAYS - taskAge) / 86400_000)} days.`,
            taskId: task.id,
          }).catch(console.error);
          staleNotified.push(task.id);
        }
      }
    }

    // Standard deadline expiry
    if (deadline > now) continue;

    task.status = "expired";
    if (redis) {
      await redis.set(`task:${task.id}`, JSON.stringify(task));
    }
    expired.push(task.id);

    if (task.onChainId !== null) {
      const refundTx = await refundEscrow(task.onChainId).catch((err) => {
        console.error(`[Cron] Refund on expiry failed for task ${task.id}:`, err);
        return null;
      });
      if (refundTx) {
        addNotification({
          userId: task.poster,
          type: "task_expired",
          title: "Task expired",
          body: `"${task.description.slice(0, 40)}..." expired. $${task.bountyUsdc} USDC refunded.`,
          taskId: task.id,
        }).catch(console.error);
      }
    }

    broadcastEvent("task:expired", {
      taskId: task.id,
      description: task.description.slice(0, 60),
    });
  }

  return NextResponse.json({
    expired: expired.length,
    expiredTaskIds: expired,
    archived: archived.length,
    archivedTaskIds: archived,
    staleNotified: staleNotified.length,
    reminded: reminded.length,
    escrowV2Swept: sweptV2,
    checkedAt: new Date().toISOString(),
  });
}
