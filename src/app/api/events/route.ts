import { NextRequest } from "next/server";
import { addClient, removeClient, startHeartbeat, getRecentEvents } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  startHeartbeat();

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : 0;

  const missedEvents = since ? await getRecentEvents(since) : [];

  // Cap SSE connections at 30 seconds. On Vercel, long-lived serverless
  // functions burn CPU the entire time they're open. The client-side
  // EventSource will auto-reconnect when the connection closes.
  const MAX_CONNECTION_MS = 30_000;

  const stream = new ReadableStream({
    start(controller) {
      addClient(controller);

      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`: connected\n\n`));

      // Send missed events since last connection
      for (const event of missedEvents) {
        const message = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      }

      // Auto-close after MAX_CONNECTION_MS to free the serverless function
      setTimeout(() => {
        try {
          controller.close();
        } catch {
          // already closed
        }
        removeClient(controller);
      }, MAX_CONNECTION_MS);
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
