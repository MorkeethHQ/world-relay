import type { Task, TaskStatus, TaskCategory, TaskType, RewardType, AiFollowUp, RecurringConfig } from "./types";
import { getRedis } from "./redis";
import { getAgent } from "./agents";
import { recordFundingReward } from "./proof-of-favour";
import { CUSTODY_RETIRED } from "./custody";
export type { Task, TaskStatus, TaskCategory };

const TASK_PREFIX = "task:";
const TASK_LIST_KEY = "task_ids";

async function persistTask(task: Task): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await Promise.all([
    redis.set(`${TASK_PREFIX}${task.id}`, JSON.stringify(task)),
    redis.sadd(TASK_LIST_KEY, task.id),
  ]);
}

// Invariant 6 (one escrow funds one payout): an on-chain escrow id may back at
// most ONE task. Claim it atomically (SET NX) so a second task can never bind an
// escrow that is already funding another task — the cross-task escrow-drain
// vector where task B references task A's funded onChainId and settles against
// the live on-chain amount. Returns false if the escrow is already bound elsewhere.
const ONCHAIN_BIND_PREFIX = "escrow:bind:";

export async function claimOnChainId(onChainId: number, taskId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no store (unit tests/local) — nothing to enforce against
  const key = `${ONCHAIN_BIND_PREFIX}${onChainId}`;
  const claimed = await redis.set(key, taskId, { nx: true });
  if (claimed) return true;
  // Already bound — allow only if it is THIS task re-binding the same escrow (idempotent).
  const owner = await redis.get(key);
  return owner === taskId;
}

function normalizeTask(task: Task): Task {
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
  if ((task as any).rewardType === undefined) {
    (task as any).rewardType = (task as any).escrowTxHash ? "usdc" : "points";
  }
  if ((task as any).donOnChainId === undefined) {
    (task as any).donOnChainId = null;
  }
  if ((task as any).donStakeTxHash === undefined) {
    (task as any).donStakeTxHash = null;
  }
  if ((task as any).requiresClaim === undefined) {
    (task as any).requiresClaim = false;
  }
  if ((task as any).pendingRelease === undefined) {
    (task as any).pendingRelease = false;
  }
  if ((task as any).settlementTx === undefined) {
    (task as any).settlementTx = null;
  }
  if ((task as any).maxCompletions === undefined) {
    (task as any).maxCompletions = 1;
  }
  if ((task as any).escrowV2Address === undefined) {
    (task as any).escrowV2Address = null;
  }
  if ((task as any).escrowV2Version === undefined) {
    (task as any).escrowV2Version = null;
  }
  if ((task as any).escrowV2RefundTx === undefined) {
    (task as any).escrowV2RefundTx = null;
  }
  if ((task as any).completionCount === undefined) {
    (task as any).completionCount = 0;
  }
  return task;
}

export async function createTask(input: {
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
  rewardType?: RewardType;
  donOnChainId?: number | null;
  requiresClaim?: boolean;
  maxCompletions?: number;
  campaignId?: string;
}): Promise<Task> {
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
  // Invariant 6: if this task is funded, atomically claim the escrow so it can
  // never be bound to a second task. Fail closed (throw) before persisting.
  if (input.onChainId != null && !(await claimOnChainId(input.onChainId, id))) {
    throw new Error(`escrow ${input.onChainId} is already bound to another task`);
  }
  const task: Task = {
    id,
    poster: input.poster,
    claimant: null,
    category: input.category || "custom",
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
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
    // Custody retired: an omitted rewardType used to default to "usdc", which
    // minted unfunded money favours promising a funding flow that no longer
    // exists. Points is the only honest default now.
    rewardType: input.rewardType || (CUSTODY_RETIRED ? "points" : "usdc"),
    donOnChainId: input.donOnChainId ?? null,
    donStakeTxHash: null,
    claimantVerification: null,
    requiresClaim: input.requiresClaim ?? false,
    pendingRelease: false,
    maxCompletions: input.maxCompletions ?? 1,
    completionCount: 0,
    createdAt: new Date().toISOString(),
  };
  await persistTask(task);
  return task;
}

export async function spawnRecurringTask(completedTask: Task): Promise<Task | null> {
  if (!completedTask.recurring) return null;
  const newCompletedRuns = completedTask.recurring.completedRuns + 1;

  completedTask.recurring.completedRuns = newCompletedRuns;
  await persistTask(completedTask);

  if (newCompletedRuns >= completedTask.recurring.totalRuns) return null;

  const next = await createTask({
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
  await persistTask(next);
  return next;
}

export async function seedTask(task: Task): Promise<void> {
  // Invariant 6: a seeded task that carries an escrow must claim its onChainId
  // bind too — otherwise this path (though currently unused) would be a way to
  // persist a funded task with no bind, reopening the cross-task escrow-drain
  // that createTask/setOnChainId close. Fail closed if the escrow is bound elsewhere.
  if (task.onChainId != null && !(await claimOnChainId(task.onChainId, task.id))) {
    throw new Error(`escrow ${task.onChainId} is already bound to another task`);
  }
  await persistTask(task);
}

export async function hasAgentTasks(): Promise<boolean> {
  const tasks = await listTasks();
  return tasks.some(t => t.agent !== null && t.agent !== undefined);
}

export async function getTask(id: string): Promise<Task | undefined> {
  const redis = getRedis();
  if (!redis) return undefined;
  try {
    const raw = await redis.get(`${TASK_PREFIX}${id}`);
    if (!raw) return undefined;
    const task: Task = typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
    return normalizeTask(task);
  } catch (err) {
    console.error(`[Store] Redis get failed for task ${id}:`, err);
    return undefined;
  }
}

export async function listTasks(): Promise<Task[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const ids = await redis.smembers(TASK_LIST_KEY);
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`${TASK_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const tasks: Task[] = [];
    for (const raw of results) {
      if (!raw) continue;
      const task: Task = typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
      tasks.push(normalizeTask(task));
    }

    return tasks.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (err) {
    console.error("[Store] Redis listTasks failed:", err);
    return [];
  }
}

export async function cancelTask(id: string, poster: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  // Only the poster can cancel
  if (task.poster !== poster) return null;
  // Can only cancel open or claimed tasks (not completed/expired/failed/cancelled)
  if (task.status !== "open" && task.status !== "claimed") return null;
  task.status = "cancelled";
  await persistTask(task);
  return task;
}

export async function claimTask(
  id: string,
  claimant: string,
  verificationLevel?: "orb" | "device" | "wallet" | null,
): Promise<Task | null> {
  const redis = getRedis();
  if (!redis) return null;

  const lockKey = `lock:claim:${id}`;
  const acquired = await redis.set(lockKey, "1", { nx: true, px: 10000 });
  if (!acquired) return null;

  try {
    const task = await getTask(id);
    if (!task || task.status !== "open") return null;
    if (task.poster === claimant) return null;
    // Reject if this claimant previously failed verification on this task
    const hasFailed = await redis.sismember(`failed_claimants:${id}`, claimant);
    if (hasFailed) return null;
    task.claimant = claimant;
    task.status = "claimed";
    task.claimantVerification = verificationLevel ?? null;
    await persistTask(task);
    return task;
  } finally {
    await redis.del(lockKey);
  }
}

export async function submitProof(
  id: string,
  proofImageUrl: string | null,
  proofNote: string | null,
  proofImages?: string[] | null,
  submitter?: string | null,
  verificationLevel?: "orb" | "device" | "wallet" | null
): Promise<Task | null> {
  const redis = getRedis();
  const lockKey = `lock:proof:${id}`;
  if (redis) {
    const acquired = await redis.set(lockKey, "1", { nx: true, px: 30000 });
    if (!acquired) return null;
  }

  try {
    const task = await getTask(id);
    if (!task) return null;
    if (task.status !== "open" && task.status !== "claimed") return null;
    if (task.status === "open") {
      // An open task has no claimant yet. Proof may attach only if the submitter
      // is claiming it in the same step (verify-proof always passes a submitter;
      // the XMTP flow requires a prior CLAIM). Without one there is no claimant
      // to verify or pay, so reject rather than orphan the proof.
      if (!submitter) return null;
      task.claimant = submitter;
      task.status = "claimed";
      task.claimantVerification = verificationLevel ?? null;
    }
    task.proofImageUrl = proofImageUrl;
    task.proofImages = proofImages && proofImages.length > 0 ? proofImages : proofImageUrl ? [proofImageUrl] : null;
    task.proofNote = proofNote;
    await persistTask(task);
    return task;
  } finally {
    if (redis) await redis.del(lockKey);
  }
}

export async function completeTask(
  id: string,
  result: { verdict: "pass" | "flag" | "fail"; reasoning: string; confidence: number }
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.verificationResult = result;
  if (result.verdict === "pass") {
    task.completionCount = (task.completionCount || 0) + 1;
    if (task.maxCompletions > 1 && task.completionCount < task.maxCompletions) {
      task.status = "open";
      task.claimant = null;
      task.claimantVerification = null;
      task.proofImageUrl = null;
      task.proofImages = null;
      task.proofNote = null;
      task.verificationResult = null;
    } else {
      task.status = "completed";
    }
  } else if (result.verdict === "fail") {
    // Track the failed claimant before clearing
    const redis = getRedis();
    if (redis && task.claimant) {
      await redis.sadd(`failed_claimants:${id}`, task.claimant);
    }
    task.status = "open";
    task.claimant = null;
    task.claimantVerification = null;
    task.proofImageUrl = null;
    task.proofImages = null;
    task.proofNote = null;
    task.verificationResult = null;
  }
  await persistTask(task);
  return task;
}

// Settlement state helpers. A funded "pass" is marked settlement-pending until
// the USDC payout forward is confirmed on-chain; only then is it marked settled.
// This keeps a verified-but-unpaid task from reading as fully paid, and lets the
// reconciliation cron find and retry it. See src/lib/escrow.ts (releaseEscrow).
export async function markSettlementPending(id: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.pendingRelease = true;
  task.settlementTx = null;
  await persistTask(task);
  return task;
}

export async function markSettled(id: string, forwardTx: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.pendingRelease = false;
  task.settlementTx = forwardTx;
  await persistTask(task);
  // Funder earns points on the CONFIRMED settlement (money actually moved to the
  // runner) — the farm-proof point to reward funding. Idempotent; never on refund.
  await recordFundingReward(task).catch(() => {});
  return task;
}

// ---------------------------------------------------------------------------
// FavourEscrowV2 transitions. Every one of these is called ONLY after the
// server verified the corresponding on-chain state / receipt (see
// /api/escrow-v2) — the client's word is never sufficient. Each pins or
// respects the contract address the task was funded on.
// ---------------------------------------------------------------------------

export async function markEscrowV2Funded(
  id: string,
  info: { contractAddress: string; version: number; fundTxHash: string }
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.rewardType !== "usdc-v2") return null;
  // Idempotent: a second verified fund report for the same task changes nothing.
  if (task.escrowTxHash && task.escrowV2Address) return task;
  task.escrowTxHash = info.fundTxHash;
  task.escrowV2Address = info.contractAddress;
  task.escrowV2Version = info.version;
  await persistTask(task);
  return task;
}

export async function markEscrowV2Settled(
  id: string,
  releaseTxHash: string
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.rewardType !== "usdc-v2" || !task.escrowV2Address) return null;
  task.status = "completed";
  task.pendingRelease = false;
  task.settlementTx = releaseTxHash;
  task.completionCount = Math.max(task.completionCount || 0, 1);
  await persistTask(task);
  // Funder earns points on the CONFIRMED settlement — same rule as v1.
  await recordFundingReward(task).catch(() => {});
  return task;
}

export async function markEscrowV2Refunded(
  id: string,
  refundTxHash: string
): Promise<Task | null> {
  const task = await getTask(id);
  if (!task || task.rewardType !== "usdc-v2" || !task.escrowV2Address) return null;
  task.escrowV2RefundTx = refundTxHash;
  task.pendingRelease = false;
  // Money went home; the favour did not happen. Terminal, never "completed".
  if (task.status !== "completed") task.status = "expired";
  await persistTask(task);
  return task;
}

// Links an existing task to a campaign (admin backfill for tasks created before
// campaign linking existed). Pass null to unlink.
export async function setTaskCampaign(id: string, campaignId: string | null): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  if (campaignId) {
    task.campaignId = campaignId;
  } else {
    delete task.campaignId;
  }
  await persistTask(task);
  return task;
}

export async function setOnChainId(id: string, onChainId: number, escrowTxHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  // Invariant 6: refuse to bind an escrow that already funds another task.
  if (!(await claimOnChainId(onChainId, id))) {
    throw new Error(`escrow ${onChainId} is already bound to another task`);
  }
  task.onChainId = onChainId;
  task.escrowTxHash = escrowTxHash;
  await persistTask(task);
  return task;
}

export async function setDonStakeTxHash(id: string, txHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.donStakeTxHash = txHash;
  await persistTask(task);
  return task;
}

export async function setAttestationHash(id: string, txHash: string): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.attestationTxHash = txHash;
  await persistTask(task);
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
  await persistTask(task);
  return task;
}

export async function setFollowUp(id: string, question: string, confidence: number): Promise<Task | null> {
  const task = await getTask(id);
  if (!task) return null;
  task.aiFollowUp = { question, status: "pending", initialConfidence: confidence };
  await persistTask(task);
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
  await persistTask(task);
  return task;
}
