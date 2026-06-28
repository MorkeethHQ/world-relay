import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { getRedis } from "@/lib/redis";
import { broadcastEvent } from "@/lib/sse";
import { notifyClaimReminder } from "@/lib/notifications";
import { refundEscrow } from "@/lib/escrow";
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

  for (const task of tasks) {
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
            notifyClaimReminder(task.claimant, task.description, task.bountyUsdc).catch(console.error);
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
    checkedAt: new Date().toISOString(),
  });
}
