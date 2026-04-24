import { NextRequest, NextResponse } from "next/server";
import { getMessages } from "@/lib/messages";
import { getTask } from "@/lib/store";
import { postUserMessage } from "@/lib/xmtp";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ messages: await getMessages(id) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { sender, text } = body;

  if (!sender || !text) {
    return NextResponse.json({ error: "Missing sender or text" }, { status: 400 });
  }

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (sender !== task.poster && sender !== task.claimant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  await postUserMessage(id, sender, text);
  return NextResponse.json({ messages: await getMessages(id) });
}
