import { NextRequest, NextResponse } from "next/server";
import { claimTask } from "@/lib/store";
import { postClaimNotification } from "@/lib/xmtp";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { claimant } = body;

  if (!claimant) {
    return NextResponse.json({ error: "Missing claimant" }, { status: 400 });
  }

  const task = claimTask(id, claimant);
  if (!task) {
    return NextResponse.json({ error: "Cannot claim task" }, { status: 400 });
  }

  await postClaimNotification(task, claimant);

  return NextResponse.json({ task });
}
