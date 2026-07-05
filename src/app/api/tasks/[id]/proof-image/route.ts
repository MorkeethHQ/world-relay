import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/store";

// Streams a task's proof image. Task JSON no longer carries base64 blobs
// (see src/lib/task-serializer.ts); this endpoint is what those URLs point at.
// Proof images were already public in the task feed, so no new exposure.
const TERMINAL_STATUSES = new Set(["completed", "cancelled", "expired"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return new NextResponse("Not found", { status: 404 });

  const idx = Math.max(0, Math.trunc(Number(new URL(req.url).searchParams.get("i")) || 0));
  const src = task.proofImages?.[idx] ?? (idx === 0 ? task.proofImageUrl : null);
  if (!src) return new NextResponse("No proof image", { status: 404 });

  // Already an external URL (not an inline blob): send the client there.
  if (!src.startsWith("data:")) return NextResponse.redirect(src);

  const match = src.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return new NextResponse("Unsupported proof image encoding", { status: 415 });
  const [, mime, payload] = match;
  const bytes = Buffer.from(payload, "base64");

  // A terminal task's proof never changes; a live task's proof can be cleared
  // and resubmitted (fail/flag), so keep its cache window short.
  const cacheControl = TERMINAL_STATUSES.has(task.status)
    ? "public, max-age=3600, s-maxage=86400"
    : "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": cacheControl,
    },
  });
}
