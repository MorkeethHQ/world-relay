import { NextRequest, NextResponse } from "next/server";
import { getTask, setOnChainId } from "@/lib/store";
import { getAgent } from "@/lib/agents";
import { getRedis } from "@/lib/redis";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (typeof body.onChainId === "number" && typeof body.escrowTxHash === "string") {
    await setOnChainId(id, body.onChainId, body.escrowTxHash);
    task.onChainId = body.onChainId;
    task.escrowTxHash = body.escrowTxHash;
  }

  if (body.agentId) {
    const agent = getAgent(body.agentId);
    if (agent) {
      task.agent = agent;
      const redis = getRedis();
      if (redis) await redis.set(`task:${id}`, JSON.stringify(task));
    }
  }

  return NextResponse.json({ ok: true, task });
}
