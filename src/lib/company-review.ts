import { createHash, randomUUID } from "crypto";
import { getRedis } from "./redis";
import { jsonSnapshot } from "./redis-snapshot";
import { isSinglePayout } from "./store";
import type { Task } from "./types";
import { prepareCompletionReputation, forgetReputation, type UserReputation } from "./reputation";
import { completionPointsFor, withPreparedPointsAward } from "./proof-of-favour";
import { buildContribution, contributionsKey, CONTRIBUTIONS_MAX } from "./completions";
import { DRAFT_PREFIX } from "./campaign-drafts";
import type { CampaignDraft, CampaignResult } from "./campaign-draft-shape";
import { evidenceUrl, type CompanyEvidence, type CompanyDecision, type CompanyReview } from "./company-review-shape";

export const EVIDENCE_PREFIX = "campaign:company:private-evidence:";
export const DECISION_PREFIX = "campaign:company:private-decisions:";
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

export type CompanyCompletionReceipt = { taskId: string; evidenceId: string; verification: NonNullable<Task["verificationResult"]>; pointsAwarded: number; streakBonus: number };
export const companyCompletionKey = (taskId: string, wallet: string) => `company:completion:${taskId}:${wallet.toLowerCase()}`;
export async function getCompanyCompletion(taskId: string, wallet: string): Promise<CompanyCompletionReceipt | null> {
  const redis = getRedis();
  if (!redis) throw new Error("Company completion storage unavailable");
  const raw = await redis.get(companyCompletionKey(taskId, wallet));
  if (!raw) return null;
  const receipt = parse<CompanyCompletionReceipt>(raw);
  if (receipt.taskId !== taskId || receipt.verification?.verdict !== 'pass' || !Number.isFinite(receipt.pointsAwarded) || !Number.isFinite(receipt.streakBonus)) throw new Error("Invalid company completion receipt");
  forgetReputation(wallet);
  return receipt;
}

// Validate all keys before writing. Task transition, completion slot and private
// evidence, points, reputation and History become visible together. A lost reply
// is recovered through the authenticated completion receipt without another award.
export const REGISTER_COMPANY_EVIDENCE = `
local types={'string','string','list','set','set','string','string','set','zset','list','string','string'}
for i=1,#KEYS do
 local t=redis.call('TYPE',KEYS[i]).ok
 local want=types[i]
 if t~='none' and t~=want then return redis.error_reply('Evidence store type mismatch') end
end
local registered=redis.call('EXISTS',KEYS[1])==1
if registered and ARGV[5]=='pass' then return 0 end
local raw=redis.call('GET',KEYS[2])
if not raw or redis.sha1hex(raw)~=ARGV[3] then return -1 end
if ARGV[5]=='pass' and redis.call('SISMEMBER',KEYS[4],ARGV[4])==1 then return -1 end
if ARGV[5]=='pass' then
 if redis.call('GET',KEYS[7])~=ARGV[7] then return -2 end
 local profile=redis.call('GET',KEYS[6]); if (profile and redis.sha1hex(profile) or '')~=ARGV[6] then return -2 end
 if redis.call('EXISTS',KEYS[11])==1 then return 0 end
 local rep=redis.call('GET',KEYS[12]); if (rep and redis.sha1hex(rep) or '')~=ARGV[14] then return -2 end
end
redis.call('SET',KEYS[2],ARGV[2])
if ARGV[5]=='pass' then redis.call('SADD',KEYS[4],ARGV[4]) else redis.call('SADD',KEYS[5],ARGV[4]) end
if not registered then redis.call('SET',KEYS[1],ARGV[1]); redis.call('LPUSH',KEYS[3],ARGV[1]) end
if ARGV[5]=='pass' then
 redis.call('SET',KEYS[6],ARGV[8]); redis.call('SADD',KEYS[8],ARGV[13])
 redis.call('ZINCRBY',KEYS[9],ARGV[9],ARGV[13]); redis.call('EXPIRE',KEYS[9],1209600)
 redis.call('LPUSH',KEYS[10],ARGV[10]); redis.call('LTRIM',KEYS[10],0,tonumber(ARGV[11])-1)
 redis.call('SET',KEYS[11],ARGV[12]); redis.call('SET',KEYS[12],ARGV[15])
end
return 1`;

// Private copy of submitted work, separate from the public verifier summaries.
// Only the proof-verification path calls this; buyers cannot fabricate an entry.
export async function recordCompanyEvidence(id: string, result: CampaignResult, note: string | null | undefined, images: string[], contributorWallet?: string, registrationKey?: string, verification?: Task["verificationResult"], proofSubmissionId?: string) {
  const redis = getRedis();
  if (!redis) throw new Error("Company evidence storage unavailable");
  const evidence: CompanyEvidence = { ...result, ...(contributorWallet ? { contributorWallet: contributorWallet.toLowerCase() } : {}), id: registrationKey ? createHash("sha256").update(JSON.stringify([id, registrationKey])).digest("hex") : randomUUID(), note: String(note || "").slice(0, 4000), images: images.map(evidenceUrl).filter((x): x is string => !!x).slice(0, 5) };
  if (registrationKey) {
    if (!verification || !contributorWallet || !proofSubmissionId) throw new Error("Missing completion context");
    const snapshot = await jsonSnapshot<Task>(`task:${result.taskId}`);
    const task = snapshot.value;
    if (!task || task.proofSubmissionId !== proofSubmissionId || task.status !== 'claimed' || task.claimant?.toLowerCase() !== contributorWallet.toLowerCase() || task.companyCampaignId !== id || (task.completionCount || 0) >= task.maxCompletions) throw new Error("Proof no longer owns an available completion");
    if (task.rewardType !== 'points' || task.onChainId != null || task.escrowTxHash || task.donOnChainId != null || task.escrowV2Address || task.campaignId || task.taskType === 'double-or-nothing') throw new Error("Company completion requires a points-only task");
    const original = structuredClone(task);
    task.verificationResult = verification;
    if (result.verdict === 'pass') {
      task.completionCount = (task.completionCount || 0) + 1;
      task.status = !isSinglePayout(task) && task.completionCount < task.maxCompletions ? 'open' : 'completed';
    } else task.status = 'open';
    if (task.status === 'open') Object.assign(task, { claimant: null, claimantVerification: null, proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null });
    const keys = [`company:evidence-registration:${evidence.id}`, `task:${result.taskId}`, `${EVIDENCE_PREFIX}${id}`, `completed_claimants:${result.taskId}`, `failed_claimants:${result.taskId}`];
    const args: (string | number)[] = [JSON.stringify(evidence), JSON.stringify(task), snapshot.hash, contributorWallet.toLowerCase(), result.verdict];
    if (result.verdict === 'pass') return withPreparedPointsAward(original.claimant!, async p => {
      const repKey = `rep:${original.claimant}`;
      const rep = await jsonSnapshot<UserReputation>(repKey);
      const nextRep = prepareCompletionReputation(rep.value, original.claimant!, original.bountyUsdc, verification.confidence, original.claimantVerification || undefined, false, evidence.id);
      if (![nextRep.tasksCompleted, nextRep.tasksFailed, nextRep.totalPointsEarned, nextRep.totalEarnedUsdc, nextRep.currentStreak, nextRep.longestStreak, nextRep.avgConfidence].every(Number.isFinite)) throw new Error("Invalid reputation profile");
      const award = p.prepareCompletion(completionPointsFor(original.rewardType, original.bountyUsdc), evidence.id, nextRep.currentStreak);
      const receipt: CompanyCompletionReceipt = { taskId: original.id, evidenceId: evidence.id, verification, pointsAwarded: award.points, streakBonus: award.streakBonus };
      const history = buildContribution({ taskId: original.id, description: original.description, points: award.points, streakBonus: award.streakBonus, proofImageUrl: images[0], proofNote: note, campaignId: id, now: Date.parse(evidence.at) });
      const committed = await redis.eval(REGISTER_COMPANY_EVIDENCE,
        [...keys, p.profileKey, p.lease.key, p.indexKey, p.weeklyKey, contributionsKey(contributorWallet), companyCompletionKey(original.id, contributorWallet), repKey],
        [...args, p.profileHash, p.lease.token, JSON.stringify(award.profile), award.points, JSON.stringify(history), CONTRIBUTIONS_MAX, JSON.stringify(receipt), original.claimant!, rep.hash, JSON.stringify(nextRep)]);
      if (Number(committed) !== 1) throw new Error("Completion changed; reload and retry");
      forgetReputation(original.claimant!);
      return receipt;
    });
    const committed = await redis.eval(REGISTER_COMPANY_EVIDENCE, keys, args);
    if (Number(committed) !== 1) throw new Error("Completion changed; reload and retry");
  } else {
    // Compatibility for direct local fixtures. Live verification always provides
    // its stable content/verdict key; jury evidence uses its existing transaction.
    await redis.lpush(`${EVIDENCE_PREFIX}${id}`, JSON.stringify(evidence));
  }
}

async function owned(owner: string, id: string): Promise<CampaignDraft | null> {
  const redis = getRedis();
  if (!redis) throw new Error("Company review storage unavailable");
  const raw = await redis.get(`${DRAFT_PREFIX}${id}`);
  if (!raw) return null;
  const draft = parse<CampaignDraft>(raw);
  return draft.owner === owner.toLowerCase() ? draft : null;
}

export async function getCompanyReview(owner: string, id: string): Promise<CompanyReview | null> {
  const draft = await owned(owner, id);
  if (!draft) return null;
  const redis = getRedis()!;
  const [evidence, decisions] = await Promise.all([
    redis.lrange(`${EVIDENCE_PREFIX}${id}`, 0, -1), redis.lrange(`${DECISION_PREFIX}${id}`, 0, -1),
  ]);
  return { campaign: { id: draft.id, company: draft.company, brief: draft.brief, status: draft.status, productName: draft.productName, productUrl: draft.productUrl }, evidence: evidence.map(x => { const { contributorWallet: _wallet, ...safe } = parse<CompanyEvidence>(x); return safe; }), decisions: decisions.map(x => parse<CompanyDecision>(x)) };
}

export async function saveCompanyDecision(owner: string, id: string, body: unknown) {
  const review = await getCompanyReview(owner, id);
  if (!review) return { ok: false as const, status: 404, error: "No such campaign." };
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const question = typeof b.question === "string" ? b.question.trim() : "";
  const decision = typeof b.decision === "string" ? b.decision.trim() : "";
  if (question.length < 10 || question.length > 500) return { ok: false as const, status: 400, error: "Write the decision question in 10 to 500 characters." };
  if (decision.length > 4000 || (decision.length > 0 && decision.length < 20)) return { ok: false as const, status: 400, error: "Explain what you will change, or why you will keep things as they are (20 to 4,000 characters)." };
  if (!Array.isArray(b.evidenceIds) || b.evidenceIds.some(x => typeof x !== "string")) return { ok: false as const, status: 400, error: "Choose evidence from this campaign." };
  const evidenceIds = [...new Set(b.evidenceIds as string[])];
  const known = new Set(review.evidence.map(x => x.id));
  if (evidenceIds.some(x => !known.has(x))) return { ok: false as const, status: 400, error: "One of those pieces is not evidence from this campaign." };
  if (decision && !evidenceIds.length) return { ok: false as const, status: 400, error: "Choose at least one piece of evidence behind this decision." };
  const entry: CompanyDecision = { id: randomUUID(), question, decision, evidenceIds, at: new Date().toISOString() };
  // Append-only history: concurrent decisions cannot overwrite one another.
  await getRedis()!.lpush(`${DECISION_PREFIX}${id}`, JSON.stringify(entry));
  return { ok: true as const, entry };
}
