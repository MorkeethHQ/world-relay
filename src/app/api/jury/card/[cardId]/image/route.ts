import { NextRequest, NextResponse } from "next/server";
import { getCardAnswer } from "@/lib/jury";
import { getCompanyAppeal } from "@/lib/company-appeal";
import { getAuthedAddress } from "@/lib/session";
import { getTask } from "@/lib/store";

// Serves a jury card's proof image WITHOUT revealing the underlying task id —
// the card is opaque, so a judge can't cross-reference the proof against the
// public board to derive the answer (audit 2026-07-06). Resolves the task
// server-side from the stored card answer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const answer = await getCardAnswer(cardId);
  if (!answer) return new NextResponse("Not found", { status: 404 });
  // A decoy is text only and is not a task: there is no image, and there is no
  // task to look up. Answered like any card with no photo.
  if (answer.decoy || answer.proofTaskId.startsWith("decoy:")) return new NextResponse("No proof image", { status: 404 });
  if (answer.companyAppealId && (!answer.judge || getAuthedAddress(_req, Date.now()) !== answer.judge.toLowerCase())) return new NextResponse("Not your review", { status: 403 });
  const task = answer.companyAppealId ? null : await getTask(answer.proofTaskId);
  const review = answer.companyAppealId ? await getCompanyAppeal(answer.companyAppealId) : null;
  const src = review?.images[0] ?? task?.proofImages?.[0] ?? task?.proofImageUrl ?? null;
  if (!src) return new NextResponse("No proof image", { status: 404 });
  // An absolute URL (blob storage) or, in the local fixture, a path on this
  // site. A bare path made redirect() throw and the card showed no photo.
  if (!src.startsWith("data:")) return NextResponse.redirect(new URL(src, _req.url));

  const match = src.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return new NextResponse("Unsupported encoding", { status: 415 });
  const bytes = Buffer.from(match[2], "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": match[1], "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=600" },
  });
}
