import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { listTasks } from "@/lib/store";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({ secret: req.nextUrl.searchParams.get("secret") || "" }));
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const confirm = req.nextUrl.searchParams.get("confirm") === "true";
  const mode = req.nextUrl.searchParams.get("mode") || "fake";

  const tasks = await listTasks();

  let toDelete;
  if (mode === "all") {
    toDelete = tasks;
  } else {
    // "fake" mode: remove tasks with no on-chain escrow backing
    toDelete = tasks.filter((t) => t.onChainId === null && !t.escrowTxHash);
  }

  const remaining = tasks.filter((t) => !toDelete.find(d => d.id === t.id));

  if (!confirm) {
    return NextResponse.json({
      dryRun: true,
      wouldDelete: toDelete.length,
      wouldKeep: remaining.length,
      keeping: remaining.map((t) => ({ id: t.id, description: t.description.slice(0, 60), onChainId: t.onChainId })),
      deleting: toDelete.map((t) => ({ id: t.id, description: t.description.slice(0, 60) })),
    });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis not available" }, { status: 503 });
  }

  for (const t of toDelete) {
    await redis.del(`task:${t.id}`);
    await redis.srem("task_ids", t.id);
    await redis.del(`msgs:${t.id}`);
  }

  return NextResponse.json({
    deleted: toDelete.length,
    remaining: remaining.length,
    kept: remaining.map((t) => ({ id: t.id, description: t.description.slice(0, 60), onChainId: t.onChainId })),
  });
}
