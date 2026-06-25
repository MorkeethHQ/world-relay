import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { getRedis } from "@/lib/redis";
import { broadcastEvent } from "@/lib/sse";
import { notifyClaimReminder } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await listTasks();
  const now = Date.now();
  const expired: string[] = [];
  const reminded: string[] = [];

  const redis = getRedis();

  for (const task of tasks) {
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
    const deadline = new Date(task.deadline).getTime();
    if (deadline > now) continue;

    task.status = "expired";
    if (redis) {
      await redis.set(`task:${task.id}`, JSON.stringify(task));
    }
    expired.push(task.id);

    broadcastEvent("task:expired", {
      taskId: task.id,
      description: task.description.slice(0, 60),
    });
  }

  return NextResponse.json({
    expired: expired.length,
    expiredTaskIds: expired,
    reminded: reminded.length,
    checkedAt: new Date().toISOString(),
  });
}
