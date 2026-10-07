import { randomUUID } from "crypto";
import { getRedis } from "./redis";
import { DRAFT_PREFIX } from "./campaign-drafts";
import type { CampaignDraft, CampaignResult } from "./campaign-draft-shape";
import { evidenceUrl, type CompanyEvidence, type CompanyDecision, type CompanyReview } from "./company-review-shape";

export const EVIDENCE_PREFIX = "campaign:company:private-evidence:";
export const DECISION_PREFIX = "campaign:company:private-decisions:";
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

// Private copy of submitted work, separate from the public verifier summaries.
// Only the proof-verification path calls this; buyers cannot fabricate an entry.
export async function recordCompanyEvidence(id: string, result: CampaignResult, note: string | null | undefined, images: string[], contributorWallet?: string) {
  const redis = getRedis();
  if (!redis) throw new Error("Company evidence storage unavailable");
  const evidence: CompanyEvidence = { ...result, ...(contributorWallet ? { contributorWallet: contributorWallet.toLowerCase() } : {}), id: randomUUID(), note: String(note || "").slice(0, 4000), images: images.map(evidenceUrl).filter((x): x is string => !!x).slice(0, 5) };
  await redis.lpush(`${EVIDENCE_PREFIX}${id}`, JSON.stringify(evidence));
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
