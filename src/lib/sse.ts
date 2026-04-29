import { getRedis } from "./redis";

export type SSEEventType =
  | "task:created"
  | "task:claimed"
  | "task:proof"
  | "task:verified"
  | "task:completed"
  | "task:failed"
  | "task:expired"
  | "task:disputed";

export interface SSEEventPayload {
  taskId: string;
  description?: string;
  location?: string;
  bountyUsdc?: number;
  status?: string;
  agentName?: string;
  verdict?: string;
  confidence?: number;
  timestamp?: string;
}

const SSE_EVENTS_KEY = "sse:events";
const MAX_EVENTS = 100;

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

function sendToLocalClients(message: string): void {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);
  for (const controller of clients) {
    try {
      controller.enqueue(encoded);
    } catch {
      clients.delete(controller);
    }
  }
}

export function broadcastEvent(type: SSEEventType, data: SSEEventPayload): void {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  // Send to clients connected to this instance
  sendToLocalClients(message);

  // Persist event to Redis so other instances can pick it up
  const redis = getRedis();
  if (redis) {
    const event = JSON.stringify({ type, data, ts: Date.now() });
    redis.lpush(SSE_EVENTS_KEY, event).then(() =>
      redis.ltrim(SSE_EVENTS_KEY, 0, MAX_EVENTS - 1)
    ).catch(() => {});
  }
}

export async function getRecentEvents(since: number): Promise<Array<{ type: SSEEventType; data: SSEEventPayload; ts: number }>> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.lrange(SSE_EVENTS_KEY, 0, MAX_EVENTS - 1);
    const events: Array<{ type: SSEEventType; data: SSEEventPayload; ts: number }> = [];
    for (const item of raw) {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      if (parsed.ts > since) events.push(parsed);
    }
    return events.reverse();
  } catch {
    return [];
  }
}

// Heartbeat: keeps connections alive every 15 seconds
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(): void {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const message = `: heartbeat ${Date.now()}\n\n`;
    sendToLocalClients(message);
  }, 15_000);
}

startHeartbeat();
