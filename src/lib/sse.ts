// Server-Sent Events broadcast infrastructure
// Keeps a module-level set of connected clients and broadcasts events to all.

export type SSEEventType =
  | "task:created"
  | "task:claimed"
  | "task:proof"
  | "task:verified"
  | "task:completed"
  | "task:failed";

export interface SSEEventPayload {
  taskId: string;
  description: string;
  location: string;
  bountyUsdc: number;
  status: string;
  agentName?: string;
  verdict?: string;
  confidence?: number;
  timestamp: string;
}

const clients = new Set<ReadableStreamDefaultController>();

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
}

export function getClientCount(): number {
  return clients.size;
}

export function broadcastEvent(type: SSEEventType, data: SSEEventPayload): void {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  for (const controller of clients) {
    try {
      controller.enqueue(encoded);
    } catch {
      // Client disconnected; clean up
      clients.delete(controller);
    }
  }
}

// Heartbeat: keeps connections alive every 15 seconds
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const message = `: heartbeat ${Date.now()}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);
    for (const controller of clients) {
      try {
        controller.enqueue(encoded);
      } catch {
        clients.delete(controller);
      }
    }
  }, 15_000);
}

// Start heartbeat immediately on module load
startHeartbeat();
