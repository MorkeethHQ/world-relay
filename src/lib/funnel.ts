import type { Redis } from "@upstash/redis";
import { getRedis } from "./redis";
import type { FunnelEvent } from "./client-funnel";

export const FUNNEL_EVENTS: readonly FunnelEvent[] = ["onboarding_started", "onboarding_completed", "wallet_auth_succeeded", "wallet_auth_failed", "daily_entered", "jury_entered", "task_detail_viewed", "claim_succeeded", "claim_failed", "proof_submitted"];
const TTL_SECONDS = 90 * 86400;
const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// CIDs are opaque random device tokens. This store contains no wallet, task,
// content, IP, failure reason, or other user data.
export async function trackFunnelEvent(cid: string, event: FunnelEvent): Promise<void> {
  const redis = getRedis();
  if (!redis || !/^[0-9a-f-]{16,64}$/i.test(cid)) return;
  const today = day();
  const eventKey = `funnel:event:${today}:${event}`;
  const writes: Promise<unknown>[] = [redis.sadd(eventKey, cid), redis.expire(eventKey, TTL_SECONDS)];
  if (event === "onboarding_started") {
    const first = await redis.sadd("funnel:onboarding-seen", cid);
    writes.push(redis.expire("funnel:onboarding-seen", TTL_SECONDS));
    if (Number(first) === 1) {
      const cohortKey = `funnel:cohort:${today}`;
      writes.push(redis.sadd(cohortKey, cid), redis.expire(cohortKey, TTL_SECONDS));
    }
  }
  await Promise.all(writes);
}

export type FunnelReader = Pick<Redis, "scard" | "sinter">;
export async function computeFunnel(reader: FunnelReader, opts: { days?: number; now?: number } = {}) {
  const count = Math.min(Math.max(opts.days ?? 7, 1), 30);
  const now = opts.now ?? Date.now();
  const days = [] as Array<{ date: string; cohort: number; steps: Partial<Record<FunnelEvent, number>> }>;
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = day(now - offset * 86_400_000);
    const cohortKey = `funnel:cohort:${date}`;
    const cohort = Number(await reader.scard(cohortKey)) || 0;
    const pairs = await Promise.all(FUNNEL_EVENTS.map(async event => [event, (await reader.sinter(cohortKey, `funnel:event:${date}:${event}`)).length] as const));
    days.push({ date, cohort, steps: Object.fromEntries(pairs) });
  }
  return { days };
}
