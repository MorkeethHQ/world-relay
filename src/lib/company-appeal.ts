import { createHash, randomUUID } from "crypto";
import type { Task } from "./types";
import type { CampaignDraft, CampaignResult } from "./campaign-draft-shape";
import type { CompanyAppeal, CompanyAppealHistory } from "./company-appeal-shape";
import { getRedis } from "./redis";
import { jsonSnapshot } from "./redis-snapshot";
import { isAppealable, appealOutcome, isQualifiedJudge, getJudgeStats, JUDGE_MIN_GRADED, JUDGE_MIN_ACCURACY } from "./jury-appeal";
import { completionPointsFor, withPreparedPointsAward } from "./proof-of-favour";
import { buildContribution, completedClaimantsKey, contributionsKey, CONTRIBUTIONS_MAX } from "./completions";
import { DRAFT_PREFIX, kindOfTask, shortAddress } from "./campaign-drafts";
import { EVIDENCE_PREFIX } from "./company-review";
import { evidenceUrl, type CompanyEvidence } from "./company-review-shape";

const PREFIX = "company:appeal:";
const indexKey = (wallet: string) => `company:appeals:${wallet.toLowerCase()}`;
const parse = <T>(raw: unknown): T => (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
export function companyProofId(task: Task): string {
  return createHash("sha256").update(JSON.stringify([task.id, task.proofSubmissionId, task.companyCampaignId, task.poster.toLowerCase(), task.description, task.rewardType, task.bountyUsdc, task.claimant?.toLowerCase(), task.proofImageUrl, task.proofImages, task.proofNote, task.verificationResult])).digest("hex");
}
export async function getCompanyAppeal(id: string): Promise<CompanyAppeal | null> {
  const raw = await getRedis()?.get(`${PREFIX}${id}`);
  return raw ? parse<CompanyAppeal>(raw) : null;
}

// Called after an AI flag, and on deck load for older flagged company pieces.
// This creates only a pending review, never an award or a human verdict.
export async function ensureCompanyAppeal(task: Task): Promise<CompanyAppeal | null> {
  const redis = getRedis();
  if (!redis || !task.companyCampaignId || task.status !== "claimed" || !isAppealable(task)) return null;
  const draft = (await jsonSnapshot<CampaignDraft>(`${DRAFT_PREFIX}${task.companyCampaignId}`)).value;
  if (!draft || draft.status !== "published" || draft.reviewRule !== "ai_and_jury" || draft.owner !== task.poster.toLowerCase()) return null;
  // Earlier appeal versions could award points without a completion record.
  // Never replay those votes into this transaction; they need reconciliation.
  if (await redis.exists(`appeal:resolved:${task.id}`) || await redis.scard(`appeal:voters:${task.id}`)) return null;
  const id = companyProofId(task);
  const entry: CompanyAppeal = { id, taskId: task.id, campaignId: draft.id, company: draft.company, owner: draft.owner,
    participant: task.claimant!.toLowerCase(), description: task.description, note: task.proofNote ?? "",
    images: task.proofImages?.length ? task.proofImages : [task.proofImageUrl!], aiReason: task.verificationResult!.reasoning,
    at: new Date().toISOString(), votes: [], outcome: "pending", points: 0 };
  await redis.eval(`
    for i=1,3 do local t=redis.call('TYPE',KEYS[i]).ok; local expected=i==1 and 'string' or 'set'; if t~='none' and t~=expected then return redis.error_reply('Review store type mismatch') end end
    if redis.call('SET',KEYS[1],ARGV[1],'NX') then redis.call('SADD',KEYS[2],ARGV[2]); redis.call('SADD',KEYS[3],ARGV[2]) end
    return 1`, [`${PREFIX}${id}`, indexKey(entry.owner), indexKey(entry.participant)], [JSON.stringify(entry), id]);
  return getCompanyAppeal(id);
}

export async function companyAppealHistory(wallet: string): Promise<CompanyAppealHistory[]> {
  const redis = getRedis();
  if (!redis) throw new Error("Review storage unavailable");
  const ids = await redis.smembers(indexKey(wallet));
  const cases = await Promise.all(ids.map(id => getCompanyAppeal(String(id))));
  return (await Promise.all(cases.filter((c): c is CompanyAppeal => !!c && (c.owner === wallet || c.participant === wallet)).map(async c => {
    const { owner, participant: _participant, images: _images, votes, ...rest } = c;
    const current = c.outcome === "pending" ? (await jsonSnapshot<Task>(`task:${c.taskId}`)).value : null;
    const outcome = c.outcome === "pending" && (!current || current.status !== "claimed" || companyProofId(current) !== c.id) ? "superseded" as const : c.outcome;
    return { ...rest, outcome, role: owner === wallet ? "company" as const : "contributor" as const, votes: votes.map(({ judge: _judge, ...vote }) => vote) };
  }))).sort((a,b) => b.at.localeCompare(a.at));
}

// All validations occur BEFORE any mutation: Lua runtime errors do not roll back.
// CAS hashes bind the exact task, campaign, case and profile bytes we prepared.
// The proof lock also excludes the existing verify-proof/resubmit path.
export const COMMIT_COMPANY_VOTE = `
local expected={'string','string','string','string','string','string','hash','set','list','list','list','set','set','zset'}
for i=1,#KEYS do local t=redis.call('TYPE',KEYS[i]).ok; if t~='none' and t~=expected[i] then return 'storage_type' end end
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[2])~=ARGV[2] then return 'lock_expired' end
for i=3,6 do local raw=redis.call('GET',KEYS[i]); local hash=raw and redis.sha1hex(raw) or ''; if hash~=ARGV[i] then return 'changed' end end
local judged=tonumber(redis.call('HGET',KEYS[7],'judged') or '0'); local correct=tonumber(redis.call('HGET',KEYS[7],'correct') or '0')
if not judged or not correct or judged<tonumber(ARGV[17]) or correct/judged<tonumber(ARGV[18]) then return 'unqualified' end
if ARGV[7]=='cleared' and redis.call('SISMEMBER',KEYS[8],ARGV[8])==1 then return 'already_completed' end
redis.call('SET',KEYS[4],ARGV[9])
if ARGV[7]~='pending' then
  redis.call('SET',KEYS[3],ARGV[10])
  redis.call('LPUSH',KEYS[10],ARGV[11]); redis.call('LTRIM',KEYS[10],0,99)
  redis.call('LPUSH',KEYS[11],ARGV[12])
  if ARGV[7]=='cleared' then
    redis.call('SADD',KEYS[8],ARGV[8]); redis.call('LPUSH',KEYS[9],ARGV[13]); redis.call('LTRIM',KEYS[9],0,tonumber(ARGV[16])-1)
    redis.call('SET',KEYS[6],ARGV[14]); redis.call('SADD',KEYS[13],ARGV[8]); redis.call('ZINCRBY',KEYS[14],ARGV[15],ARGV[8]); redis.call('EXPIRE',KEYS[14],1209600)
  else redis.call('SADD',KEYS[12],ARGV[8]) end
end
return 'ok'`;

export async function recordCompanyAppealVote(judge: string, id: string, real: boolean, reason: unknown) {
  const redis = getRedis();
  const j = judge.toLowerCase();
  if (!redis) return { error: "Review storage unavailable" };
  if (typeof reason !== "string" || reason.trim().length < 20 || reason.trim().length > 1000) return { error: "Explain your review in 20 to 1,000 characters." };
  const initial = await getCompanyAppeal(id);
  if (!initial) return { error: "Review no longer exists" };
  if (j === initial.owner || j === initial.participant) return { error: "You cannot review your own company or contribution." };
  if (!isQualifiedJudge(await getJudgeStats(j))) return { error: "Complete 10 graded cards at 60% accuracy before reviewing flagged work." };
  const verifyKey = `lock:verify:${initial.taskId}`;
  const token = randomUUID();
  if (!await redis.set(verifyKey, token, { nx: true, px: 120000 })) return { error: "Proof is being updated. Try again." };
  try {
    return await withPreparedPointsAward(initial.participant, async p => {
      const [cs, ts, ds] = await Promise.all([
        jsonSnapshot<CompanyAppeal>(`${PREFIX}${id}`), jsonSnapshot<Task>(`task:${initial.taskId}`),
        jsonSnapshot<CampaignDraft>(`${DRAFT_PREFIX}${initial.campaignId}`),
      ]);
      const c = cs.value, task = ts.value, draft = ds.value;
      if (!c || c.outcome !== "pending") return { error: "This review is already resolved." };
      if (c.votes.some(v => v.judge === j)) return { error: "You have already reviewed this proof." };
      if (!task || task.status !== "claimed" || !isAppealable(task) || companyProofId(task) !== id || !draft || draft.status !== "published" || draft.reviewRule !== "ai_and_jury" || draft.owner !== c.owner) return { error: "The proof or campaign changed. Load the current review." };
      const at = new Date().toISOString();
      c.votes.push({ judge: j, real, reason: reason.trim(), at });
      const tally = { real: c.votes.filter(v => v.real).length, not: c.votes.filter(v => !v.real).length };
      c.outcome = appealOutcome(tally);
      const points = c.outcome === "cleared" ? completionPointsFor(task.rewardType, task.bountyUsdc) : 0;
      if (!Number.isFinite(points) || !Number.isFinite(task.completionCount) || !Number.isFinite(task.maxCompletions)) return { error: "Invalid task reward or progress. Review not saved." };
      c.points = points;
      if (c.outcome !== "pending") c.decidedAt = at;
      // Reuse the same points policy and same wallet lock, preparing the actual
      // amount only after the quorum is known (no nested wallet lock).
      const finalProfile = p.prepare(points);
      if (!Number.isFinite(finalProfile.totalPoints)) return { error: "Invalid points total. Review not saved." };
      if (c.outcome === "cleared") finalProfile.favoursCompleted += 1;
      const next = { ...task };
      if (c.outcome === "cleared") {
        next.completionCount = (next.completionCount || 0) + 1;
        next.status = next.completionCount < next.maxCompletions ? "open" : "completed";
      } else if (c.outcome === "upheld") next.status = "open";
      if (c.outcome !== "pending" && next.status === "open") {
        next.claimant = null; next.claimantVerification = null; next.proofImageUrl = null; next.proofImages = null; next.proofNote = null; next.verificationResult = null; next.aiFollowUp = null;
      }
      // AI's recorded flag stays a flag on a completed task. Human approval is
      // separate, never relabelled as an AI pass or fed into its graded deck.
      if (next.status === "completed") next.humanReview = { caseId: id, outcome: "cleared", at };
      const summary = `Human review: ${tally.real} accept, ${tally.not} decline. ${c.outcome === "cleared" ? "Accepted for points." : "Not accepted."}`;
      const result: CampaignResult = { taskId: task.id, kind: kindOfTask(draft, task.id), verdict: c.outcome === "cleared" ? "pass" : "fail", reason: summary, participant: shortAddress(c.participant), at, reviewMethod: "human_jury" };
      const evidence: CompanyEvidence = { ...result, id, contributorWallet: c.participant, note: c.note, images: c.images.map((v, i) => evidenceUrl(v) ?? (/^data:image\/(jpeg|png|webp|gif);base64,/.test(v) ? `/api/campaigns/drafts/${draft.id}/review/${id}/image?index=${i}` : null)).filter((v): v is string => !!v), reviewReasons: c.votes.map(v => v.reason) };
      const contribution = buildContribution({ taskId: task.id, description: task.description, points, streakBonus: 0, proofImageUrl: task.proofImageUrl, proofNote: task.proofNote, campaignId: draft.id, campaignLabel: draft.company, now: Date.parse(at) });
      const keys = [verifyKey, p.lease.key, `task:${task.id}`, `${PREFIX}${id}`, `${DRAFT_PREFIX}${draft.id}`, p.profileKey,
        `jury:stats:${j}`, completedClaimantsKey(task.id), contributionsKey(c.participant), `campaign:company:results:${draft.id}`, `${EVIDENCE_PREFIX}${draft.id}`, `failed_claimants:${task.id}`, p.indexKey, p.weeklyKey];
      const committed = await redis.eval(COMMIT_COMPANY_VOTE, keys, [token, p.lease.token, ts.hash, cs.hash, ds.hash, p.profileHash, c.outcome, c.participant,
        JSON.stringify(c), JSON.stringify(next), JSON.stringify(result), JSON.stringify(evidence), JSON.stringify(contribution), JSON.stringify(finalProfile), points, CONTRIBUTIONS_MAX, JUDGE_MIN_GRADED, JUDGE_MIN_ACCURACY]);
      if (committed !== "ok") return { error: `Review could not be saved (${committed}). Reload and try again.` };
      return { counted: true, outcome: c.outcome, tally, pointsAwardedToClaimant: points };
    });
  } finally {
    await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", [verifyKey], [token]);
  }
}
