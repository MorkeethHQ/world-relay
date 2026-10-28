import { getRedis } from "./redis";

// The receipt contains no proof image or note and is never part of public task JSON.
export async function recordProofConsent(taskId: string, submitter: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try { await redis.set(`proof:consent:${taskId}:${submitter.toLowerCase()}`, JSON.stringify({ version: "proof-review-20261025", at: new Date().toISOString(), taskId, submitter, scope: "Send proof and note for AI or human review and show submitted proof in task History" })); return true; }
  catch { return false; }
}
