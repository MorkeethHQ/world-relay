import { NextRequest, NextResponse } from "next/server";
import { getTask, posterConfirm, setAttestationHash } from "@/lib/store";
import { getMessages } from "@/lib/messages";
import { mediateDispute } from "@/lib/ai-chat";
import { postDisputeVerdict } from "@/lib/xmtp";
import { notifyVerified } from "@/lib/notifications";
import { postAttestation } from "@/lib/attestation";
import { recordCompletion, recordFailure } from "@/lib/reputation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { poster } = body;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.verificationResult?.verdict !== "flag") {
    return NextResponse.json({ error: "Task not in flagged state" }, { status: 400 });
  }
  if (task.poster !== poster) {
    return NextResponse.json({ error: "Only poster can request mediation" }, { status: 403 });
  }

  const messages = await getMessages(id);
  const threadHistory = messages
    .map(m => `[${m.sender === "relay-bot" ? "RELAY" : m.sender}]: ${m.text}`)
    .join("\n");

  const proofBase64 = task.proofImageUrl
    ? task.proofImageUrl.replace(/^data:image\/\w+;base64,/, "")
    : null;

  const verdict = await mediateDispute(task, proofBase64, threadHistory);

  await postDisputeVerdict(id, verdict.approved, verdict.reasoning, task.bountyUsdc, verdict.confidence);

  const updated = await posterConfirm(id, verdict.approved);

  if (verdict.approved && task.claimant) {
    notifyVerified(task.claimant, task.bountyUsdc).catch(console.error);
    recordCompletion(task.claimant, task.bountyUsdc, verdict.confidence).catch(console.error);

    if (proofBase64) {
      const txHash = await postAttestation(
        id, task.description, proofBase64.slice(0, 100), "pass", verdict.confidence
      ).catch(() => null);
      if (txHash) await setAttestationHash(id, txHash);
    }
  } else if (!verdict.approved && task.claimant) {
    recordFailure(task.claimant).catch(console.error);
  }

  return NextResponse.json({
    taskId: id,
    dispute: verdict,
    task: await getTask(id),
  });
}
