import { NextRequest, NextResponse } from "next/server";
import { getTask, setOnChainId } from "@/lib/store";
import { getAgent } from "@/lib/agents";
import { getRedis } from "@/lib/redis";

/** Strip sensitive / internal fields from a task for public responses. */
function publicTask(task: Record<string, unknown>) {
  return {
    id: task.id,
    poster: task.poster,
    claimant: task.claimant ?? null,
    description: task.description,
    location: task.location,
    lat: task.lat ?? null,
    lng: task.lng ?? null,
    bountyUsdc: task.bountyUsdc,
    deadline: task.deadline,
    status: task.status,
    category: task.category ?? null,
    proofImageUrl: task.proofImageUrl ?? null,
    proofNote: task.proofNote ?? null,
    verificationResult: task.verificationResult
      ? {
          verdict: (task.verificationResult as Record<string, unknown>).verdict,
          confidence: (task.verificationResult as Record<string, unknown>).confidence,
        }
      : null,
    attestationTxHash: task.attestationTxHash ?? null,
    agent: task.agent
      ? {
          name: (task.agent as Record<string, unknown>).name,
          icon: (task.agent as Record<string, unknown>).icon ?? null,
        }
      : null,
    createdAt: task.createdAt,
    onChainId: task.onChainId ?? null,
    escrowTxHash: task.escrowTxHash ?? null,
  };
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

  return NextResponse.json({ task: publicTask(task as unknown as Record<string, unknown>) });
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

  return NextResponse.json({ ok: true, task: publicTask(task as unknown as Record<string, unknown>) });
}
