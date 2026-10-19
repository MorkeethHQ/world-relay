// PAID REVIEW SLOTS, storage side. One plan per project (campaign:pay:<id>,
// written once by the post route for a draft the caller owns, like the picture
// record). Slots are ordinary tasks on the existing escrow-v2 rail: taking a
// slot creates ONE task with rewardType usdc-v2, claimant = the reviewer, status
// claimed, so /api/escrow-v2 prepare-fund, verify-funded, prepare-release,
// verify-released, prepare-refund and verify-refunded work on it unchanged, and
// /api/verify-proof refuses the review until it is funded (its own rule).

import { getRedis } from "@/lib/redis";
import { listTasks, createTask as storeCreateTask, claimTask as storeClaimTask } from "@/lib/store";
import { isPaySlot, payPlanOrNull, paySlotDescription, takeReason, PAY_SLOT_HOURS, type PayPlan } from "@/lib/pay-plan";
import type { Task } from "@/lib/types";

export const PAY_PREFIX = "campaign:pay:";
export const TAKE_LOCK_PREFIX = "lock:pay-take:";

export async function savePayPlan(campaignId: string, plan: PayPlan): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(`${PAY_PREFIX}${campaignId}`, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export async function getPayPlan(campaignId: string): Promise<PayPlan | null> {
  const redis = getRedis();
  if (!redis) return null;
  return payPlanOrNull(await redis.get(`${PAY_PREFIX}${campaignId}`).catch(() => null));
}

/** Every slot task of a project, oldest first. */
export async function listPaySlots(campaignId: string): Promise<Task[]> {
  const all = await listTasks();
  return all.filter((t) => isPaySlot(t, campaignId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type CreateSlotFn = (input: {
  poster: string; description: string; bountyUsdc: number; companyCampaignId: string;
}) => Promise<Task>;
export type ClaimSlotFn = (id: string, claimant: string) => Promise<Task | null>;

const defaultCreate: CreateSlotFn = (i) =>
  storeCreateTask({
    poster: i.poster,
    category: "review",
    description: i.description,
    location: "Online",
    bountyUsdc: i.bountyUsdc,
    deadlineHours: PAY_SLOT_HOURS,
    rewardType: "usdc-v2",
    maxCompletions: 1,
    requiresClaim: true,
    companyCampaignId: i.companyCampaignId,
  });

/**
 * A reviewer takes one slot. Under a per-project lock so two taps cannot pass
 * the count. The slot is claimed in the same step; the review route refuses
 * proof until the builder funds it, so an unfunded slot costs nobody anything.
 */
export async function takePaySlot(
  campaignId: string,
  owner: string,
  productName: string,
  ask: string,
  reviewer: string,
  create: CreateSlotFn = defaultCreate,
  claim: ClaimSlotFn = (id, c) => storeClaimTask(id, c, "wallet"),
): Promise<{ ok: true; task: Task } | { ok: false; error: string; status: number }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Paid reviews cannot be taken right now.", status: 503 };
  const plan = await getPayPlan(campaignId);
  const lockKey = `${TAKE_LOCK_PREFIX}${campaignId}`;
  const locked = await redis.set(lockKey, "1", { nx: true, px: 10_000 });
  if (!locked) return { ok: false, error: "Someone else is taking a slot. Try again.", status: 409 };
  try {
    const slots = await listPaySlots(campaignId);
    const why = takeReason(plan, slots, reviewer, owner);
    if (why) return { ok: false, error: why, status: plan ? 409 : 404 };
    const task = await create({
      poster: owner.toLowerCase(),
      description: paySlotDescription(productName, ask),
      bountyUsdc: plan!.perReviewUsd,
      companyCampaignId: campaignId,
    });
    const claimed = await claim(task.id, reviewer);
    if (!claimed) return { ok: false, error: "The slot could not be claimed. Try again.", status: 503 };
    return { ok: true, task: claimed };
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}
