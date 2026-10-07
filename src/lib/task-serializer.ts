import type { Task } from "./types";

// Proof images are stored in Redis as base64 data URLs (100-350KB each) and used
// to be returned inline in task JSON. That made GET /api/tasks grow past 8MB and
// take 5-15s to download on mobile, and the payload grew with every completed
// photo task. API responses now replace inline blobs with a stable URL to
// /api/tasks/[id]/proof-image, which streams the bytes with CDN caching.
// Clients keep rendering proofImageUrl / proofImages[] as normal <img src> values.
const isDataUrl = (u: string | null | undefined): u is string => !!u && u.startsWith("data:");

export function proofImagePath(taskId: string, index: number): string {
  return `/api/tasks/${taskId}/proof-image?i=${index}`;
}

export function toApiTask(task: Task): Task {
  const hasBlob = isDataUrl(task.proofImageUrl) || (task.proofImages || []).some(isDataUrl);
  if (!hasBlob) return task;
  return {
    ...task,
    // submitProof keeps proofImageUrl === proofImages[0], so index 0 is the cover.
    proofImageUrl: isDataUrl(task.proofImageUrl) ? proofImagePath(task.id, 0) : task.proofImageUrl,
    proofImages: task.proofImages
      ? task.proofImages.map((u, i) => (isDataUrl(u) ? proofImagePath(task.id, i) : u))
      : null,
  };
}

export function toApiTasks(tasks: Task[]): Task[] {
  return tasks.map(toApiTask);
}

// Development-era artifacts (dev_/demo_/e2e_ identities, security-audit
// wallets) stay in the store as history but never reach public surfaces —
// they were crowding the History wall and the jury deck with junk proofs.
//
// `agent_` is NOT a test identity: it is the poster prefix POST /api/agent/tasks
// (the API-key door, the MCP server, the Python SDK) stamps on every bot-posted
// favour. It rode into this regex in 5215ca8 unjustified, which made every
// agent-door favour invisible to the humans meant to close it (2026-09-03:
// 0 of 182 live tasks carried the prefix, so nothing resurfaces).
const TEST_IDENTITY = /^(dev_|demo_|e2e_)|ATTACKER/;
// R16: the operator's hidden state (scripts/hide-item.mjs). The task stays
// stored; every public read (list, search, agent list, detail) leaves it out.
//
// A per-person Welcome instance (welcomeFor, 2026-10-05) is private to its owner
// and reads as hidden on every public surface too: the detail routes answer 404,
// and the lists never hold one (the store keeps instances out of the shared list).
// The owner reads theirs through GET /api/welcome, behind the session.
export function isHiddenTask(t: Pick<Task, "hiddenAt"> & { welcomeFor?: string }): boolean {
  if (typeof t.welcomeFor === "string" && t.welcomeFor.length > 0) return true;
  return typeof t.hiddenAt === "string" && t.hiddenAt.length > 0;
}

export function isPublicTask(t: Task): boolean {
  if (isHiddenTask(t)) return false;
  return !TEST_IDENTITY.test(t.poster || "") && !TEST_IDENTITY.test(t.claimant || "");
}

// Retired offers leave discovery; claims and historical results remain visible.
export function isRetiredBetOffer(t: Pick<Task, "taskType" | "donOnChainId" | "status">): boolean {
  return t.status === "open" && (t.taskType === "double-or-nothing" || t.donOnChainId != null);
}
