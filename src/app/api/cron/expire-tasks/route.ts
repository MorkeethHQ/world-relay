import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { getRedis } from "@/lib/redis";
import { broadcastEvent } from "@/lib/sse";
import { seedDemoTasks } from "@/lib/seed-agents";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await listTasks();
  const now = Date.now();
  const expired: string[] = [];

  const redis = getRedis();

  for (const task of tasks) {
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

  // Seed fresh demo tasks after cleanup
  let seedResult: { created: string[]; skipped: boolean; reason?: string } = { created: [], skipped: true };
  try {
    seedResult = await seedDemoTasks();
  } catch (err) {
    console.error("[Cron] Seed failed:", err);
  }

  return NextResponse.json({
    expired: expired.length,
    expiredTaskIds: expired,
    seeded: seedResult.created.length,
    seededTasks: seedResult.created,
    seedSkipped: seedResult.skipped,
    checkedAt: new Date().toISOString(),
  });
}
