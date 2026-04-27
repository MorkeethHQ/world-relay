import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/store";
import { assertTaskCompletion, disputeTaskAssertion, settleTaskAssertion, getUmaDisputeState, isUmaEnabled } from "@/lib/uma-oracle";
import { broadcastEvent } from "@/lib/sse";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = await getUmaDisputeState(id);
  return NextResponse.json({
    umaEnabled: isUmaEnabled(),
    dispute: state,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ip = getClientIp(req);
  const { ok } = rateLimit(`escalate:${ip}`, 5, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isUmaEnabled()) {
    return NextResponse.json({ error: "UMA Oracle not configured" }, { status: 503 });
  }

  const body = await req.json();
  const { action, address } = body;

  if (!action || !address) {
    return NextResponse.json({ error: "Missing action or address" }, { status: 400 });
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (action === "assert") {
    if (task.verificationResult?.verdict !== "flag") {
      return NextResponse.json({ error: "Can only escalate flagged tasks" }, { status: 400 });
    }
    if (address !== task.claimant) {
      return NextResponse.json({ error: "Only the runner can assert completion" }, { status: 403 });
    }

    const result = await assertTaskCompletion(id, task.description, address);
    if (!result) {
      return NextResponse.json({ error: "Failed to submit assertion" }, { status: 500 });
    }

    broadcastEvent("task:verified", {
      taskId: id,
      description: task.description.slice(0, 60),
      status: "disputed",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      action: "asserted",
      assertionId: result.assertionId,
      txHash: result.txHash,
      challengeWindow: "2 hours",
    });
  }

  if (action === "dispute") {
    if (address !== task.poster) {
      return NextResponse.json({ error: "Only the poster can dispute" }, { status: 403 });
    }

    const result = await disputeTaskAssertion(id, address);
    if (!result) {
      return NextResponse.json({ error: "Failed to dispute — no active assertion or already disputed" }, { status: 400 });
    }

    return NextResponse.json({
      action: "disputed",
      txHash: result.txHash,
    });
  }

  if (action === "settle") {
    const result = await settleTaskAssertion(id);
    if (!result) {
      return NextResponse.json({ error: "Failed to settle — assertion not ready" }, { status: 400 });
    }

    return NextResponse.json({
      action: "settled",
      resolution: result.resolution,
      txHash: result.txHash,
    });
  }

  return NextResponse.json({ error: "Invalid action. Use: assert, dispute, settle" }, { status: 400 });
}
