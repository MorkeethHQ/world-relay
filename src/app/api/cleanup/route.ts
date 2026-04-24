import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { listTasks } from "@/lib/store";

const BOUNTY_THRESHOLD = 2;

export async function POST(req: NextRequest) {
  const confirm = req.nextUrl.searchParams.get("confirm") === "true";

  const tasks = await listTasks();
  const toDelete = tasks.filter((t) => t.bountyUsdc > BOUNTY_THRESHOLD);

  if (!confirm) {
    return NextResponse.json({
      dryRun: true,
      deleted: toDelete.length,
      remaining: tasks.length - toDelete.length,
      ids: toDelete.map((t) => t.id),
    });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not available" },
      { status: 503 },
    );
  }

  for (const t of toDelete) {
    await redis.del(`task:${t.id}`);
    await redis.srem("task_ids", t.id);
  }

  return NextResponse.json({
    deleted: toDelete.length,
    remaining: tasks.length - toDelete.length,
    ids: toDelete.map((t) => t.id),
  });
}
