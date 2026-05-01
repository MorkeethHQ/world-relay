import { getRedis } from "@/lib/redis";

export type InAppNotification = {
  id: string;
  userId: string; // wallet address or "agent:id"
  type: "task_claimed" | "proof_submitted" | "verified" | "flagged" | "funded" | "cancelled";
  title: string;
  body: string;
  taskId: string;
  read: boolean;
  createdAt: string;
};

const NOTIF_PREFIX = "notifications:";
const MAX_PER_USER = 50;

function notifKey(userId: string): string {
  return `${NOTIF_PREFIX}${userId}`;
}

export async function addNotification(
  notif: Omit<InAppNotification, "id" | "read" | "createdAt">
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const full: InAppNotification = {
    ...notif,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    read: false,
    createdAt: new Date().toISOString(),
  };

  const key = notifKey(notif.userId);
  await redis.lpush(key, JSON.stringify(full));
  await redis.ltrim(key, 0, MAX_PER_USER - 1);
}

export async function getNotifications(
  userId: string,
  limit: number = 20
): Promise<InAppNotification[]> {
  const redis = getRedis();
  if (!redis) return [];

  const raw = await redis.lrange(notifKey(userId), 0, limit - 1);
  return raw.map((item) => {
    if (typeof item === "string") return JSON.parse(item) as InAppNotification;
    return item as unknown as InAppNotification;
  });
}

export async function markRead(userId: string, notifId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = notifKey(userId);
  const all = await redis.lrange(key, 0, MAX_PER_USER - 1);

  for (let i = 0; i < all.length; i++) {
    const item = typeof all[i] === "string" ? JSON.parse(all[i] as string) : (all[i] as unknown as InAppNotification);
    if (item.id === notifId) {
      item.read = true;
      await redis.lset(key, i, JSON.stringify(item));
      break;
    }
  }
}

export async function markAllRead(userId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = notifKey(userId);
  const all = await redis.lrange(key, 0, MAX_PER_USER - 1);

  const pipeline = all.map(async (raw, i) => {
    const item = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as InAppNotification);
    if (!item.read) {
      item.read = true;
      await redis.lset(key, i, JSON.stringify(item));
    }
  });

  await Promise.all(pipeline);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const all = await redis.lrange(notifKey(userId), 0, MAX_PER_USER - 1);
  let count = 0;
  for (const raw of all) {
    const item = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as InAppNotification);
    if (!item.read) count++;
  }
  return count;
}
