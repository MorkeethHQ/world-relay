import { NextRequest, NextResponse } from "next/server";
import { getTask, setOnChainId } from "@/lib/store";
import { getAgent } from "@/lib/agents";
import { getRedis } from "@/lib/redis";
import { isEscrowTaskFunded } from "@/lib/escrow";
import { toApiTask } from "@/lib/task-serializer";

/** Return full task detail, omitting only internal keys like claimCode. */
function detailTask(task: Record<string, unknown>) {
  const { claimCode, ...rest } = task;
  return rest;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task: detailTask(toApiTask(task) as unknown as Record<string, unknown>) });
}

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

  // Auth: only the original poster or admin can PATCH
  const ADMIN_SECRET = process.env.ADMIN_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const isAdmin = !!ADMIN_SECRET && authHeader === `Bearer ${ADMIN_SECRET}`;
  const isPoster = body.poster && body.poster === task.poster;
  if (!isAdmin && !isPoster) {
    return NextResponse.json({ error: "Unauthorized: only the task poster or admin can modify this task" }, { status: 403 });
  }

  if (typeof body.onChainId === "number" && typeof body.escrowTxHash === "string") {
    // Same server-side funding gate as POST /api/tasks: never trust a
    // client-supplied escrow marker. Without this, a poster (identity is just a
    // public address) could point their own task at ANY funded on-chain escrow
    // id and have the settlement path pay it out. Only store the marker if the
    // on-chain escrow task actually exists and holds a bounty covering this task.
    const funded = await isEscrowTaskFunded(body.onChainId, task.bountyUsdc).catch(() => false);
    if (!funded) {
      return NextResponse.json({ error: "Escrow funding could not be verified on-chain for that task id" }, { status: 400 });
    }
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

  return NextResponse.json({ ok: true, task: detailTask(task as unknown as Record<string, unknown>) });
}
