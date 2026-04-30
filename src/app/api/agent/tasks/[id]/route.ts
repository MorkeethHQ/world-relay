import { NextRequest, NextResponse } from "next/server";
import { getTask, cancelTask } from "@/lib/store";
import { broadcastEvent } from "@/lib/sse";
import { checkAgentAuth } from "@/lib/api-keys";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAgentAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized", hint: "Pass your API key as: Authorization: Bearer <key>" }, { status: 401 });
  }

  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    task: {
      id: task.id,
      poster: task.poster,
      claimant: task.claimant,
      description: task.description,
      location: task.location,
      lat: task.lat,
      lng: task.lng,
      bountyUsdc: task.bountyUsdc,
      category: task.category,
      deadline: task.deadline,
      status: task.status,
      onChainId: task.onChainId,
      escrowTxHash: task.escrowTxHash,
      proofImageUrl: task.proofImageUrl,
      proofNote: task.proofNote,
      verificationResult: task.verificationResult,
      attestationTxHash: task.attestationTxHash,
      agentName: task.agent?.name,
      createdAt: task.createdAt,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAgentAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: "Unauthorized", hint: "Pass your API key as: Authorization: Bearer <key>" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Only agent-posted tasks can be cancelled via API
  if (!task.poster.startsWith("agent_")) {
    return NextResponse.json(
      { error: "Forbidden", message: "Only agent-posted tasks can be cancelled via API" },
      { status: 403 }
    );
  }

  // Can only cancel open or claimed tasks
  if (task.status !== "open" && task.status !== "claimed") {
    return NextResponse.json(
      { error: "Conflict", message: `Cannot cancel task with status "${task.status}"` },
      { status: 409 }
    );
  }

  const cancelled = await cancelTask(id, task.poster);

  if (!cancelled) {
    return NextResponse.json(
      { error: "Failed to cancel task" },
      { status: 500 }
    );
  }

  broadcastEvent("task:cancelled", {
    taskId: cancelled.id,
    description: cancelled.description.slice(0, 60),
    location: cancelled.location,
    bountyUsdc: cancelled.bountyUsdc,
    status: cancelled.status,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    task: {
      id: cancelled.id,
      poster: cancelled.poster,
      description: cancelled.description,
      location: cancelled.location,
      bountyUsdc: cancelled.bountyUsdc,
      deadline: cancelled.deadline,
      status: cancelled.status,
      createdAt: cancelled.createdAt,
    },
  });
}
