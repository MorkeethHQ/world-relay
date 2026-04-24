import { getRedis } from "./redis";

export type Message = {
  id: string;
  taskId: string;
  sender: "relay-bot" | string;
  text: string;
  timestamp: string;
};

const MSG_PREFIX = "msgs:";
const localCache = new Map<string, Message[]>();

export async function addMessage(taskId: string, sender: string, text: string): Promise<Message> {
  const msg: Message = {
    id: crypto.randomUUID(),
    taskId,
    sender,
    text,
    timestamp: new Date().toISOString(),
  };

  const cached = localCache.get(taskId) || [];
  cached.push(msg);
  localCache.set(taskId, cached);

  const redis = getRedis();
  if (redis) {
    await redis.rpush(`${MSG_PREFIX}${taskId}`, JSON.stringify(msg)).catch(console.error);
  }

  return msg;
}

export async function getMessages(taskId: string): Promise<Message[]> {
  const redis = getRedis();
  if (!redis) return localCache.get(taskId) || [];

  const raw = await redis.lrange(`${MSG_PREFIX}${taskId}`, 0, -1);
  const messages: Message[] = raw.map((r) =>
    typeof r === "string" ? JSON.parse(r) : (r as Message)
  );
  localCache.set(taskId, messages);
  return messages;
}
