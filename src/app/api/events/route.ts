import { addClient, removeClient, startHeartbeat } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  startHeartbeat();

  const stream = new ReadableStream({
    start(controller) {
      addClient(controller);

      // Send initial connection confirmation
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`: connected\n\n`));
    },
    cancel(controller) {
      removeClient(controller as ReadableStreamDefaultController);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
