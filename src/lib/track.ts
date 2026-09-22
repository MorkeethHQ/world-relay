import { after } from "next/server";
import { getRedis } from "./redis";

// EVERY TRACKED WRITE OUTLIVES THE RESPONSE (2026-09-22). About 20 API routes call
// trackEvent(...).catch(() => {}) without awaiting it, then answer. On Vercel a
// function may be frozen once it has answered, so such a write can be lost:
// observed on 22 Sep, when two walks each sent mission_started before /api/track
// awaited it and the fresh report counted 1. One fix here instead of 20 edits:
// each write is handed to Next's after(), which keeps the function alive until it
// settles. Outside a request (scripts, tests) after() throws, and the write simply
// runs as before. The returned promise is the same, so awaiting callers still wait.
function outliveResponse<T>(work: Promise<T>): Promise<T> {
  try {
    after(() => work.then(() => undefined, () => undefined));
  } catch {
    // Not inside a request scope: nothing to keep alive.
  }
  return work;
}

export function trackVisitor(address: string): Promise<void> {
  return outliveResponse(writeVisitor(address));
}
async function writeVisitor(address: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    redis.sadd("visitors:all", address),
    redis.sadd(`visitors:${today}`, address),
    redis.expire(`visitors:${today}`, 90 * 86400),
  ]);
}

// Reach: every app-open, deduped by a persistent per-device client id (fired by
// PageTracker on load, ANONYMOUS opens included). This is the same thing World's
// portal counts as "users" — our visitors:all only captured people who reached
// sign-in, missing everyone who opened and bounced. Keyed by client id (not
// wallet), so it counts real distinct opens with no sign-in dependency.
export function trackReach(clientId: string): Promise<void> {
  return outliveResponse(writeReach(clientId));
}
async function writeReach(clientId: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !clientId || clientId.length > 64) return;
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    redis.sadd("reach:all", clientId),
    redis.sadd(`reach:${today}`, clientId),
    redis.expire(`reach:${today}`, 90 * 86400),
  ]);
}

export function trackEvent(
  event: string,
  data?: Record<string, string | number | boolean>,
): Promise<void> {
  return outliveResponse(writeEvent(event, data));
}
async function writeEvent(
  event: string,
  data?: Record<string, string | number | boolean>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const entry = JSON.stringify({ event, ts: now.toISOString(), ...data });
  // High-frequency events keep their counters but stay OUT of the capped log:
  // ~6k feed_loaded entries were churning per-user funnel history out of the
  // 5000-entry window within days.
  const HIGH_FREQUENCY =
    event === "feed_loaded" || event === "page_view" || event === "daily_reveal_viewed";
  await Promise.all([
    ...(HIGH_FREQUENCY ? [] : [redis.lpush("events:log", entry), redis.ltrim("events:log", 0, 4999)]),
    redis.hincrby("events:counts", event, 1),
    redis.hincrby(`events:daily:${today}`, event, 1),
    redis.expire(`events:daily:${today}`, 30 * 86400),
  ]);
}
