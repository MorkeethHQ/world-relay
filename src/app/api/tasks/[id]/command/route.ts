import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/store";
import { addMessage, getMessages } from "@/lib/messages";
import { processIncomingMessage } from "@/lib/xmtp-commands";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { sender, message, imageBase64 } = body;

  if (!sender || !message) {
    return NextResponse.json(
      { error: "Missing sender or message" },
      { status: 400 }
    );
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Only the task's poster or existing claimant may drive its command thread.
  // Without this, a client-chosen `sender` could claim the task (handleClaim)
  // as any wallet, bypassing the /claim tier gate and seed cap. Claiming an open
  // task must go through /claim (which enforces those gates), not chat commands.
  const isParticipant = sender === task.poster || (!!task.claimant && sender === task.claimant);
  if (!isParticipant) {
    return NextResponse.json({ error: "Only the poster or claimant can send commands on this task" }, { status: 403 });
  }

  // Save the user's message
  await addMessage(id, sender, message);

  // Process the command
  const response = await processIncomingMessage(id, sender, message, imageBase64);

  if (response) {
    // Post the bot response to the thread
    await addMessage(id, "relay-bot", response);
  }

  return NextResponse.json({
    response,
    messages: await getMessages(id),
  });
}
