import { NextRequest, NextResponse } from "next/server";
import { getTask, resolveFollowUp, setAttestationHash } from "@/lib/store";
import { getMessages } from "@/lib/messages";
import { evaluateFollowUp } from "@/lib/ai-chat";
import { postReEvaluationResult } from "@/lib/xmtp";
import { notifyVerified, notifyFlagged } from "@/lib/notifications";
import { postAttestation } from "@/lib/attestation";
import { recordCompletion, recordFailure } from "@/lib/reputation";
import { fireWebhook } from "@/lib/webhooks";
import { releaseEscrow } from "@/lib/escrow";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (!task.aiFollowUp || task.aiFollowUp.status !== "pending") {
    return NextResponse.json({ error: "No pending follow-up for this task" }, { status: 400 });
  }
  if (!task.proofImageUrl) {
    return NextResponse.json({ error: "No proof image to re-evaluate" }, { status: 400 });
  }

  const messages = await getMessages(id);
  const followUpIndex = messages.findIndex(m =>
    m.sender === "relay-bot" && m.text.includes("AI FOLLOW-UP")
  );
  const threadAfterFollowUp = messages
    .slice(followUpIndex + 1)
    .map(m => `[${m.sender === "relay-bot" ? "RELAY" : m.sender}]: ${m.text}`)
    .join("\n");

  if (!threadAfterFollowUp.trim()) {
    return NextResponse.json({ error: "Please reply to the follow-up question first" }, { status: 400 });
  }

  const proofBase64 = task.proofImageUrl.replace(/^data:image\/\w+;base64,/, "");

  const result = await evaluateFollowUp(
    task,
    proofBase64,
    threadAfterFollowUp,
    {
      reasoning: task.verificationResult?.reasoning || "",
      confidence: task.aiFollowUp.initialConfidence,
    }
  );

  const updated = await resolveFollowUp(id, result);
  await postReEvaluationResult(id, result.verdict, result.reasoning, task.bountyUsdc, result.confidence);

  if (result.verdict === "pass" && task.claimant) {
    notifyVerified(task.claimant, task.bountyUsdc).catch(console.error);
    recordCompletion(task.claimant, task.bountyUsdc, result.confidence).catch(console.error);

    const txHash = await postAttestation(
      id, task.description, proofBase64.slice(0, 100), "pass", result.confidence
    ).catch(() => null);
    if (txHash) await setAttestationHash(id, txHash);

    if (task.onChainId !== null) {
      releaseEscrow(task.onChainId).then((releaseTx) => {
        if (releaseTx) console.log(`[Escrow] Auto-released after follow-up for task ${id}: ${releaseTx}`);
      }).catch(console.error);
    }
  } else if (result.verdict === "flag") {
    notifyFlagged(task.poster, task.description).catch(console.error);
  } else if (result.verdict === "fail" && task.claimant) {
    recordFailure(task.claimant).catch(console.error);
  }

  // Fire webhook callback if registered
  const finalTask = await getTask(id);
  if (finalTask) {
    fireWebhook(finalTask).catch(console.error);
  }

  return NextResponse.json({
    taskId: id,
    verification: result,
    task: finalTask,
  });
}
