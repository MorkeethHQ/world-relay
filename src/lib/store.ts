import type { Task, TaskStatus, TaskCategory } from "./types";
import { getRedis } from "./redis";
import { getAgent } from "./agents";
export type { Task, TaskStatus, TaskCategory };

const TASK_PREFIX = "task:";
const TASK_LIST_KEY = "task_ids";

const cache: Map<string, Task> = new Map();
let cacheHydrated = false;

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
    cache.set(task.id, task);
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
}): Task {
  const id = crypto.randomUUID();
  const agent = input.agentId ? getAgent(input.agentId) : null;
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
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent,
    createdAt: new Date().toISOString(),
  };
  cache.set(id, task);
  persistTask(task).catch(console.error);
  return task;
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
  const raw = await redis.get(`${TASK_PREFIX}${id}`);
  if (!raw) return undefined;
  const task: Task = typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
  cache.set(id, task);
  return task;
}

export async function listTasks(): Promise<Task[]> {
  await hydrateCache();
  return Array.from(cache.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function claimTask(id: string, claimant: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.status !== "open") return null;
  if (task.poster === claimant) return null;
  task.claimant = claimant;
  task.status = "claimed";
  persistTask(task).catch(console.error);
  return task;
}

export async function submitProof(
  id: string,
  proofImageUrl: string,
  proofNote: string | null
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.status !== "claimed") return null;
  task.proofImageUrl = proofImageUrl;
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
    task.proofImageUrl = null;
    task.proofNote = null;
  }
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
    task.proofImageUrl = null;
    task.proofNote = null;
    task.verificationResult = null;
  }
  persistTask(task).catch(console.error);
  return task;
}
