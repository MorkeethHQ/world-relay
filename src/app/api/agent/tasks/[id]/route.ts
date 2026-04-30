import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/store";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

function checkAuth(req: NextRequest): boolean {
  if (!AGENT_API_KEY) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  return auth.replace("Bearer ", "") === AGENT_API_KEY;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) {
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
