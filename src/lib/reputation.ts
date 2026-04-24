import { getRedis } from "./redis";

const REP_PREFIX = "rep:";

export type UserReputation = {
  address: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalEarnedUsdc: number;
  avgConfidence: number;
  verificationLevel: string;
  lastActiveAt: string;
  currentStreak: number;
  longestStreak: number;
};

const localCache = new Map<string, UserReputation>();

function defaultRep(address: string): UserReputation {
  return {
    address,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalEarnedUsdc: 0,
    avgConfidence: 0,
    verificationLevel: "wallet",
    lastActiveAt: new Date().toISOString(),
    currentStreak: 0,
    longestStreak: 0,
  };
}

export async function getReputation(address: string): Promise<UserReputation> {
  if (localCache.has(address)) return localCache.get(address)!;
  const redis = getRedis();
  if (!redis) return defaultRep(address);
  const raw = await redis.get(`${REP_PREFIX}${address}`);
  if (!raw) return defaultRep(address);
  const rep: UserReputation = typeof raw === "string" ? JSON.parse(raw) : (raw as UserReputation);
  localCache.set(address, rep);
  return rep;
}

async function saveReputation(rep: UserReputation): Promise<void> {
  localCache.set(rep.address, rep);
  const redis = getRedis();
  if (redis) {
    await redis.set(`${REP_PREFIX}${rep.address}`, JSON.stringify(rep)).catch(console.error);
  }
}

export async function recordCompletion(
  address: string,
  bountyUsdc: number,
  confidence: number,
  verificationLevel?: string
): Promise<UserReputation> {
  const rep = await getReputation(address);
  if (rep.currentStreak === undefined) rep.currentStreak = 0;
  if (rep.longestStreak === undefined) rep.longestStreak = 0;
  const total = rep.tasksCompleted + rep.tasksFailed;
  rep.avgConfidence = total > 0
    ? (rep.avgConfidence * rep.tasksCompleted + confidence) / (rep.tasksCompleted + 1)
    : confidence;
  rep.tasksCompleted += 1;
  rep.totalEarnedUsdc += bountyUsdc;
  rep.currentStreak += 1;
  if (rep.currentStreak > rep.longestStreak) rep.longestStreak = rep.currentStreak;
  rep.lastActiveAt = new Date().toISOString();
  if (verificationLevel) rep.verificationLevel = verificationLevel;
  await saveReputation(rep);
  return rep;
}

export async function recordFailure(address: string): Promise<UserReputation> {
  const rep = await getReputation(address);
  if (rep.currentStreak === undefined) rep.currentStreak = 0;
  if (rep.longestStreak === undefined) rep.longestStreak = 0;
  rep.tasksFailed += 1;
  rep.currentStreak = 0;
  rep.lastActiveAt = new Date().toISOString();
  await saveReputation(rep);
  return rep;
}

export function getSuccessRate(rep: UserReputation): number {
  const total = rep.tasksCompleted + rep.tasksFailed;
  if (total === 0) return 1;
  return rep.tasksCompleted / total;
}

export function getTrustScore(rep: UserReputation): number {
  const successRate = getSuccessRate(rep);
  const levelBonus: Record<string, number> = { orb: 0.3, device: 0.15, wallet: 0, dev: -0.2 };
  const bonus = levelBonus[rep.verificationLevel] || 0;
  const activityBonus = Math.min(rep.tasksCompleted * 0.02, 0.2);
  const streakBonus = Math.min((rep.currentStreak || 0) * 0.03, 0.15);
  return Math.min(1, Math.max(0, successRate * 0.5 + bonus + activityBonus + streakBonus + 0.2));
}

export async function getLeaderboard(limit = 10): Promise<UserReputation[]> {
  const redis = getRedis();
  if (!redis) return Array.from(localCache.values()).sort((a, b) => getTrustScore(b) - getTrustScore(a)).slice(0, limit);

  const keys = await redis.keys(`${REP_PREFIX}*`);
  if (keys.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.get(key);
  }
  const results = await pipeline.exec();

  const reps: UserReputation[] = [];
  for (const raw of results) {
    if (!raw) continue;
    const rep: UserReputation = typeof raw === "string" ? JSON.parse(raw) : (raw as UserReputation);
    reps.push(rep);
    localCache.set(rep.address, rep);
  }

  return reps.sort((a, b) => getTrustScore(b) - getTrustScore(a)).slice(0, limit);
}
