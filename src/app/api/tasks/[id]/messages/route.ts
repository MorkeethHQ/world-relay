import { NextRequest, NextResponse } from "next/server";
import { getMessages } from "@/lib/messages";
import { getTask } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ messages: getMessages(id) });
}
