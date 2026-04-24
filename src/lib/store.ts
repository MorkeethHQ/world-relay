import type { Task, TaskStatus } from "./types";
export type { Task, TaskStatus };

const tasks: Map<string, Task> = new Map();

export function createTask(input: {
  poster: string;
  description: string;
  location: string;
  lat?: number | null;
  lng?: number | null;
  bountyUsdc: number;
  deadlineHours: number;
}): Task {
  const id = crypto.randomUUID();
  const task: Task = {
    id,
    poster: input.poster,
    claimant: null,
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
    createdAt: new Date().toISOString(),
  };
  tasks.set(id, task);
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Task[] {
  return Array.from(tasks.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function claimTask(id: string, claimant: string): Task | null {
  const task = tasks.get(id);
  if (!task || task.status !== "open") return null;
  if (task.poster === claimant) return null;
  task.claimant = claimant;
  task.status = "claimed";
  return task;
}

export function submitProof(
  id: string,
  proofImageUrl: string,
  proofNote: string | null
): Task | null {
  const task = tasks.get(id);
  if (!task || task.status !== "claimed") return null;
  task.proofImageUrl = proofImageUrl;
  task.proofNote = proofNote;
  return task;
}

export function completeTask(
  id: string,
  result: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number }
): Task | null {
  const task = tasks.get(id);
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
  return task;
}

export function posterConfirm(id: string, approved: boolean): Task | null {
  const task = tasks.get(id);
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
  return task;
}
