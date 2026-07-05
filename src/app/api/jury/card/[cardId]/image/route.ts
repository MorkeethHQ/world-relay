import { NextRequest, NextResponse } from "next/server";
import { getCardAnswer } from "@/lib/jury";
import { getTask } from "@/lib/store";

// Serves a jury card's proof image WITHOUT revealing the underlying task id —
// the card is opaque, so a judge can't cross-reference the proof against the
// public board to derive the answer (audit 2026-07-06). Resolves the task
// server-side from the stored card answer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const answer = await getCardAnswer(cardId);
  if (!answer) return new NextResponse("Not found", { status: 404 });
  const task = await getTask(answer.proofTaskId);
  const src = task?.proofImages?.[0] ?? task?.proofImageUrl ?? null;
  if (!src) return new NextResponse("No proof image", { status: 404 });
  if (!src.startsWith("data:")) return NextResponse.redirect(src);

  const match = src.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return new NextResponse("Unsupported encoding", { status: 415 });
  const bytes = Buffer.from(match[2], "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": match[1], "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=600" },
  });
}
