import type { Task, TaskStatus, TaskCategory, TaskType, AiFollowUp, RecurringConfig } from "./types";
import { getRedis } from "./redis";
import { getAgent } from "./agents";
export type { Task, TaskStatus, TaskCategory };

const TASK_PREFIX = "task:";
const TASK_LIST_KEY = "task_ids";

const cache: Map<string, Task> = new Map();
let cacheHydrated = false;

export function resetCache(): void {
  cache.clear();
  cacheHydrated = false;
}

async function persistTask(task: Task): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await Promise.all([
    redis.set(`${TASK_PREFIX}${task.id}`, JSON.stringify(task)),
    redis.sadd(TASK_LIST_KEY, task.id),
  ]);
}

async function hydrateCache(): Promise<void> {
  if (cacheHydrated) return;
  const redis = getRedis();
  if (!redis) {
    cacheHydrated = true;
    return;
  }

  try {
    const ids = await redis.smembers(TASK_LIST_KEY);
    if (ids.length === 0) {
      cacheHydrated = true;
      return;
    }

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`${TASK_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    for (const raw of results) {
      if (!raw) continue;
      const task: Task = typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
      if (task.agent === undefined) task.agent = null;
      if ((task as any).aiFollowUp === undefined) task.aiFollowUp = null;
      if ((task as any).recurring === undefined) task.recurring = null;
      if ((task as any).callbackUrl === undefined) task.callbackUrl = null;
      if ((task as any).onChainId === undefined) task.onChainId = null;
      if ((task as any).escrowTxHash === undefined) task.escrowTxHash = null;
      if ((task as any).claimCode === undefined) task.claimCode = null;
      if ((task as any).proofImages === undefined) {
        (task as any).proofImages = task.proofImageUrl ? [task.proofImageUrl] : null;
      }
      if ((task as any).claimantVerification === undefined) {
        (task as any).claimantVerification = null;
      }
      if ((task as any).taskType === undefined) {
        (task as any).taskType = "standard";
      }
      if ((task as any).donOnChainId === undefined) {
        (task as any).donOnChainId = null;
      }
      if ((task as any).donStakeTxHash === undefined) {
        (task as any).donStakeTxHash = null;
      }
      cache.set(task.id, task);
    }
  } catch (err) {
    console.error("[Store] Redis hydration failed, using in-memory cache:", err);
  }
  cacheHydrated = true;
}

export function createTask(input: {
  poster: string;
  category?: TaskCategory;
  description: string;
  location: string;
  lat?: number | null;
  lng?: number | null;
  bountyUsdc: number;
  deadlineHours: number;
  agentId?: string | null;
  recurring?: { intervalHours: number; totalRuns: number; parentTaskId?: string } | null;
  callbackUrl?: string | null;
  onChainId?: number | null;
  escrowTxHash?: string | null;
  claimCode?: string | null;
  taskType?: TaskType;
  donOnChainId?: number | null;
}): Task {
  const id = crypto.randomUUID();
  const agent = input.agentId ? getAgent(input.agentId) : null;
  const recurring: RecurringConfig | null = input.recurring
    ? {
        intervalHours: input.recurring.intervalHours,
        totalRuns: input.recurring.totalRuns,
        completedRuns: 0,
        parentTaskId: input.recurring.parentTaskId || null,
      }
    : null;
  const task: Task = {
    id,
    poster: input.poster,
    claimant: null,
    category: input.category || "custom",
    description: input.description,
    location: input.location,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    bountyUsdc: input.bountyUsdc,
    deadline: new Date(Date.now() + input.deadlineHours * 3600_000).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent,
    aiFollowUp: null,
    recurring,
    callbackUrl: input.callbackUrl ?? null,
    onChainId: input.onChainId ?? null,
    escrowTxHash: input.escrowTxHash ?? null,
    claimCode: input.claimCode ?? null,
    taskType: input.taskType || "standard",
    donOnChainId: input.donOnChainId ?? null,
    donStakeTxHash: null,
    claimantVerification: null,
    createdAt: new Date().toISOString(),
  };
  cache.set(id, task);
  persistTask(task).catch(console.error);
  return task;
}

export function spawnRecurringTask(completedTask: Task): Task | null {
  if (!completedTask.recurring) return null;
  const newCompletedRuns = completedTask.recurring.completedRuns + 1;

  completedTask.recurring.completedRuns = newCompletedRuns;
  persistTask(completedTask).catch(console.error);

  if (newCompletedRuns >= completedTask.recurring.totalRuns) return null;

  const next = createTask({
    poster: completedTask.poster,
    category: completedTask.category,
    description: completedTask.description,
    location: completedTask.location,
    lat: completedTask.lat,
    lng: completedTask.lng,
    bountyUsdc: completedTask.bountyUsdc,
    deadlineHours: completedTask.recurring.intervalHours,
    agentId: completedTask.agent?.id || null,
    recurring: {
      intervalHours: completedTask.recurring.intervalHours,
      totalRuns: completedTask.recurring.totalRuns,
      parentTaskId: completedTask.recurring.parentTaskId || completedTask.id,
    },
  });

  next.recurring!.completedRuns = newCompletedRuns;
  persistTask(next).catch(console.error);
  return next;
}

/** Insert a fully-formed Task into the cache + Redis. Used for seeding demo data. */
export function seedTask(task: Task): void {
  cache.set(task.id, task);
  persistTask(task).catch(console.error);
}

export async function hasAgentTasks(): Promise<boolean> {
  await hydrateCache();
  return Array.from(cache.values()).some(t => t.agent !== null && t.agent !== undefined);
}

export async function getTask(id: string): Promise<Task | undefined> {
  await hydrateCache();
  if (cache.has(id)) return cache.get(id);

  const redis = getRedis();
  if (!redis) return undefined;
  try {
    const raw = await redis.get(`${TASK_PREFIX}${id}`);
    if (!raw) return undefined;
    const task: Task = typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
    cache.set(id, task);
    return task;
  } catch (err) {
    console.error(`[Store] Redis get failed for task ${id}:`, err);
    return undefined;
  }
}

export async function listTasks(): Promise<Task[]> {
  await hydrateCache();
  return Array.from(cache.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function claimTask(
  id: string,
  claimant: string,
  verificationLevel?: "orb" | "device" | "wallet" | null,
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.status !== "open") return null;
  if (task.poster === claimant) return null;
  task.claimant = claimant;
  task.status = "claimed";
  task.claimantVerification = verificationLevel ?? null;
  persistTask(task).catch(console.error);
  return task;
}

export async function submitProof(
  id: string,
  proofImageUrl: string | null,
  proofNote: string | null,
  proofImages?: string[] | null
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.status !== "claimed") return null;
  task.proofImageUrl = proofImageUrl;
  task.proofImages = proofImages && proofImages.length > 0 ? proofImages : proofImageUrl ? [proofImageUrl] : null;
  task.proofNote = proofNote;
  persistTask(task).catch(console.error);
  return task;
}

export async function completeTask(
  id: string,
  result: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number }
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.verificationResult = result;
  if (result.verdict === "pass") {
    task.status = "completed";
  } else if (result.verdict === "fail") {
    task.status = "open";
    task.claimant = null;
    task.claimantVerification = null;
    task.proofImageUrl = null;
    task.proofImages = null;
    task.proofNote = null;
  }
  persistTask(task).catch(console.error);
  return task;
}

export async function setOnChainId(id: string, onChainId: number, escrowTxHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.onChainId = onChainId;
  task.escrowTxHash = escrowTxHash;
  persistTask(task).catch(console.error);
  return task;
}

export async function setDonStakeTxHash(id: string, txHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.donStakeTxHash = txHash;
  persistTask(task).catch(console.error);
  return task;
}

export async function setAttestationHash(id: string, txHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.attestationTxHash = txHash;
  persistTask(task).catch(console.error);
  return task;
}

export async function posterConfirm(id: string, approved: boolean): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.verificationResult?.verdict !== "flag") return null;
  if (approved) {
    task.status = "completed";
  } else {
    task.status = "open";
    task.claimant = null;
    task.claimantVerification = null;
    task.proofImageUrl = null;
    task.proofImages = null;
    task.proofNote = null;
    task.verificationResult = null;
  }
  task.aiFollowUp = null;
  persistTask(task).catch(console.error);
  return task;
}

export async function setFollowUp(id: string, question: string, confidence: number): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.aiFollowUp = { question, status: "pending", initialConfidence: confidence };
  persistTask(task).catch(console.error);
  return task;
}

export async function resolveFollowUp(
  id: string,
  result: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number }
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.aiFollowUp = task.aiFollowUp ? { ...task.aiFollowUp, status: "resolved" } : null;
  task.verificationResult = result;
  if (result.verdict === "pass") {
    task.status = "completed";
  } else if (result.verdict === "fail") {
    task.status = "open";
    task.claimant = null;
    task.claimantVerification = null;
    task.proofImageUrl = null;
    task.proofImages = null;
    task.proofNote = null;
  }
  persistTask(task).catch(console.error);
  return task;
}
