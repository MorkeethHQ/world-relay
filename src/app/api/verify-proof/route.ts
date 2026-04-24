import { NextRequest, NextResponse } from "next/server";
import { getTask, submitProof, completeTask } from "@/lib/store";
import { verifyProof, verifyProofStub } from "@/lib/verify-proof";
import { postProofSubmitted, postVerificationResult } from "@/lib/xmtp";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId, proofImageBase64, proofNote } = body;

  if (!taskId || !proofImageBase64) {
    return NextResponse.json({ error: "Missing taskId or proof image" }, { status: 400 });
  }

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.status !== "claimed") {
    return NextResponse.json({ error: "Task not in claimed state" }, { status: 400 });
  }

  submitProof(taskId, `data:image/jpeg;base64,${proofImageBase64.slice(0, 50)}...`, proofNote || null);
  await postProofSubmitted(taskId);

  const useRealVerification = !!process.env.ANTHROPIC_API_KEY;
  let result;
  try {
    result = useRealVerification
      ? await verifyProof(task.description, proofImageBase64, proofNote)
      : verifyProofStub(task.description, proofImageBase64);
  } catch (err) {
    console.error("AI verification error, falling back to stub:", err);
    result = verifyProofStub(task.description, proofImageBase64);
  }

  completeTask(taskId, result);
  await postVerificationResult(taskId, result.verdict, result.reasoning, task.bountyUsdc);

  return NextResponse.json({
    taskId,
    verification: result,
    task: getTask(taskId),
  });
}
