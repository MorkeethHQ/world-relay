import type { Task } from "./types";
import { coarse, isWallet, publicId, sameWallet, scrubAddresses } from "./public-id";

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

// THE PUBLIC SHAPE OF A TASK IS AN ALLOW LIST (hardening pass, 2026-10-13).
//
// Before this, toApiTask returned {...task}: every stored key reached every
// reader of the feed, the detail page, search and history. Measured on
// production 2026-10-12: 40 keys per row, among them claimCode (the only lock
// on a claim-coded task) and callbackUrl. Both were null on all 294 live rows
// that day, so the first task to set one would have published it. The detail
// route stripped claimCode alone, which is "all except X": the next private
// field leaks by default.
//
// Now a key is public only if it is on PUBLIC_TASK_KEYS. A key added to Task
// must be put on one of the two lists or `tsc` and `next build` fail on the
// line below; src/__tests__/task-serializer-allowlist.test.ts parses types.ts
// at run time so `vitest` fails on the same day.
export const PUBLIC_TASK_KEYS = [
  "id",
  "poster",
  "claimant",
  "category",
  "campaignId",
  "companyCampaignId",
  "description",
  "location",
  "lat",
  "lng",
  "bountyUsdc",
  "deadline",
  "status",
  "proofImageUrl",
  "proofImages",
  "proofNote",
  "verificationResult",
  "humanReview",
  "attestationTxHash",
  "agent",
  "aiFollowUp",
  "recurring",
  "onChainId",
  "escrowTxHash",
  "taskType",
  "rewardType",
  "donOnChainId",
  "donStakeTxHash",
  "claimantVerification",
  "requiresClaim",
  "pendingRelease",
  "settlementTx",
  "escrowV2Address",
  "escrowV2Version",
  "escrowV2RefundTx",
  "maxCompletions",
  "completionCount",
  "createdAt",
  "welcomeSourceId",
] as const satisfies readonly (keyof Task)[];

// Never sent to a client. claimCode is the lock; callbackUrl is the poster's
// private endpoint; the hidden markers are the operator's; welcomeFor is the
// owner's wallet on a private instance; welcomeReviewNote reaches its owner
// through GET /api/welcome; proofSubmissionId is an internal id.
export const PRIVATE_TASK_KEYS = [
  "claimCode",
  "callbackUrl",
  "hiddenAt",
  "hiddenReason",
  "welcomeFor",
  "welcomeReviewNote",
  "proofSubmissionId",
] as const satisfies readonly (keyof Task)[];

export type PublicTaskKey = (typeof PUBLIC_TASK_KEYS)[number];
type PrivateTaskKey = (typeof PRIVATE_TASK_KEYS)[number];
type UnclassifiedTaskKey = Exclude<keyof Task, PublicTaskKey | PrivateTaskKey>;
// A Task key in neither list makes this line a type error. That is the gate:
// a new field is private by default until someone names it public.
const everyTaskKeyIsClassified: [UnclassifiedTaskKey] extends [never] ? true : never = true;
void everyTaskKeyIsClassified;

// WHO IS READING DECIDES WHAT A ROW SAYS ABOUT PEOPLE (2026-10-14, lib/public-id.ts).
//
//   a party    the session wallet is this task's poster or claimant. The row is
//              whole: the two parties pay and write to each other and need the
//              other's wallet (escrow funding, chat, a dispute).
//   signed in  any other session wallet. poster and claimant are public ids,
//              coordinates have two decimals (about 1 km).
//   signed out no session. poster and claimant are public ids, coordinates have
//              one decimal (about 11 km), and every 0x run of 40 hex characters
//              or more that is left anywhere in the row (a contract address, a
//              transaction hash, text a person typed) is replaced by "[hidden]".
//              A settlement hash names the wallet that was paid, so it goes too.
//
// The viewer comes from the session cookie and never from a query or a body.
// isOwnTask and isClaimant are worked out here, so a client never needs the
// wallet of a stranger to know which rows are its own.
//
// Limit, stated: a signed-in stranger still receives transaction hashes, and a
// hash can be looked up on chain. Closing that needs the receipts to move
// behind a party-only read.
export type Viewer = string | null;
export const COORD_PLACES_SIGNED_OUT = 1;
export const COORD_PLACES_SIGNED_IN = 2;

export type ApiTask = Pick<Task, PublicTaskKey> & { isOwnTask: boolean; isClaimant: boolean };

/** Is this viewer the poster or the claimant? An agent viewer is "agent:<id>" and matches its own posts. */
export function viewerRole(task: Pick<Task, "poster" | "claimant">, viewer: Viewer): { isOwnTask: boolean; isClaimant: boolean } {
  if (!viewer) return { isOwnTask: false, isClaimant: false };
  const same = (a: string | null | undefined) => !!a && (sameWallet(a, viewer) || (!isWallet(viewer) && a === viewer));
  return { isOwnTask: same(task.poster), isClaimant: same(task.claimant) };
}

export function toApiTask(task: Task, viewer: Viewer = null): ApiTask {
  const out = {} as Record<string, unknown>;
  for (const k of PUBLIC_TASK_KEYS) {
    if (k in task) out[k] = task[k];
  }
  // submitProof keeps proofImageUrl === proofImages[0], so index 0 is the cover.
  if (isDataUrl(task.proofImageUrl)) out.proofImageUrl = proofImagePath(task.id, 0);
  if (task.proofImages && task.proofImages.some(isDataUrl)) {
    out.proofImages = task.proofImages.map((u, i) => (isDataUrl(u) ? proofImagePath(task.id, i) : u));
  }
  const role = viewerRole(task, viewer);
  out.isOwnTask = role.isOwnTask;
  out.isClaimant = role.isClaimant;
  if (role.isOwnTask || role.isClaimant) return out as ApiTask;

  if (isWallet(out.poster)) out.poster = publicId(out.poster);
  if (isWallet(out.claimant)) out.claimant = publicId(out.claimant);
  const places = viewer ? COORD_PLACES_SIGNED_IN : COORD_PLACES_SIGNED_OUT;
  out.lat = coarse(out.lat, places);
  out.lng = coarse(out.lng, places);
  // R2 finding 5, 14 Oct 2026: every non-party gets the scrub, signed in or
  // not. A wallet typed into a note, and a receipt hash that names the wallet
  // that was paid, belong to the two parties only.
  return scrubAddresses(out) as ApiTask;
}

export function toApiTasks(tasks: Task[], viewer: Viewer = null): ApiTask[] {
  return tasks.map((t) => toApiTask(t, viewer));
}

/** The cache rule for a list of tasks. A signed-out answer may be shared; a signed-in one is that person's alone.
 *  Vary: Cookie keeps a shared cache from handing the signed-out answer to a signed-in reader. */
export function taskListCache(viewer: Viewer, shared: string): Record<string, string> {
  return viewer ? { "Cache-Control": "private, no-store", Vary: "Cookie" } : { "Cache-Control": shared, Vary: "Cookie" };
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
