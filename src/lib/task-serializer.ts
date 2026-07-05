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
const TEST_IDENTITY = /^(dev_|demo_|e2e_|agent_)|ATTACKER/;
export function isPublicTask(t: Task): boolean {
  return !TEST_IDENTITY.test(t.poster || "") && !TEST_IDENTITY.test(t.claimant || "");
}
