import { NextRequest, NextResponse } from "next/server";
import { getTask, posterConfirm } from "@/lib/store";
import { postVerificationResult } from "@/lib/xmtp";
import { fireWebhook } from "@/lib/webhooks";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { approved, poster } = body;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.poster !== poster) {
    return NextResponse.json({ error: "Only poster can confirm" }, { status: 403 });
  }

  const updated = await posterConfirm(id, approved);
  if (!updated) {
    return NextResponse.json({ error: "Task not in flagged state" }, { status: 400 });
  }

  if (approved) {
    await postVerificationResult(id, "pass", "Poster confirmed proof manually", task.bountyUsdc);
  } else {
    await postVerificationResult(id, "fail", "Poster rejected proof", task.bountyUsdc);
  }

  // Fire webhook callback if registered
  const finalTask = await getTask(id);
  if (finalTask) {
    fireWebhook(finalTask).catch(console.error);
  }

  return NextResponse.json({ task: finalTask });
}
