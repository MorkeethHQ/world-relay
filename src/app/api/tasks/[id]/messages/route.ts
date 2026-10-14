import { NextRequest, NextResponse } from "next/server";
import { addMessage, getMessages } from "@/lib/messages";
import { getTask } from "@/lib/store";
import { postUserMessage } from "@/lib/xmtp";
import { processIncomingMessage } from "@/lib/xmtp-commands";
import { getAuthedAddress, ownerRefusal, readerRefusal } from "@/lib/session";

const PRIVATE = { "Cache-Control": "private, no-store" };

// Task chat is private to the poster and the claimant. Measured on production
// 2026-10-12: this GET answered 200 with the messages to a caller with no
// cookie, for a task id taken from the public feed. The read gate is
// readerRefusal (lib/session): 401 with no session, 403 for any other wallet,
// and it ships dark behind SESSION_ENFORCE for the anonymous case only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const refusal = readerRefusal(req, [task.poster, task.claimant], Date.now());
  // The thread holds two kinds of message: the relay-bot briefing written at
  // creation, which the task page shows to every viewer (task/[id]/page.tsx
  // fetchData has no participant gate), and the chat between the two people.
  // A signed-in wallet that is not a participant keeps the public part and
  // loses the private part, instead of a 403 that would blank a page it could
  // open yesterday. An anonymous caller is refused once SESSION_ENFORCE is on.
  // R2 finding 3, 14 Oct 2026: with the switch off, readerRefusal let a caller
  // with no cookie through, and production served whole threads to anyone. A
  // caller with no session is now a non-participant whatever the switch says.
  // A non-participant gets NO messages. The bot part is not public either: the
  // bot echoes the proof note (lib/xmtp.ts postProofSubmitted) and names the
  // poster and claimant by a shortened wallet, and a stored message carries no
  // type that would mark a briefing as safe. Everything a stranger may read
  // about the task is already on the task itself.
  const anonymous = !refusal && !getAuthedAddress(req, Date.now());
  if (refusal?.status === 403 || anonymous) {
    return NextResponse.json({ messages: [], participant: false }, { headers: PRIVATE });
  }
  if (refusal) return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status, headers: PRIVATE });

  return NextResponse.json({ messages: await getMessages(id) }, { headers: PRIVATE });
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

  // `sender` is a public body field. The session must be the wallet it names,
  // and that wallet must be a participant. Both checks run before anything is
  // written. ownerRefusal is the hard gate (as post, claim and verify): it was
  // ownershipError, which honours SESSION_ENFORCE, and with the switch off the
  // favour page stored a poster's message under the doer's wallet (14 Oct 2026).
  const refusal = ownerRefusal(req, sender, Date.now());
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  if (sender !== task.poster && sender !== task.claimant) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  await postUserMessage(id, sender, text);

  // Check if the message is a command and respond inline
  const botResponse = await processIncomingMessage(id, sender, text);
  if (botResponse) {
    await addMessage(id, "relay-bot", botResponse);
  }

  return NextResponse.json({ messages: await getMessages(id) });
}
