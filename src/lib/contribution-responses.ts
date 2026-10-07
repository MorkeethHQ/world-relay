import { getRedis } from './redis';
import { jsonSnapshot } from './redis-snapshot';
import { DRAFT_PREFIX } from './campaign-drafts';
import { EVIDENCE_PREFIX } from './company-review';
import type { CampaignDraft } from './campaign-draft-shape';
import type { CompanyEvidence } from './company-review-shape';
import { evidenceUrl } from './company-review-shape';
import { EMPTY_THREAD, awaitingCompany, type ContributionThread, type CompanyResponse, type ContributionCard, type ContributionReveal } from './contribution-response-shape';
export const RESPONSE_PREFIX = 'company:responses:';
const parse = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
async function context(id: string) {
  const redis = getRedis(); if (!redis) throw new Error('Storage unavailable');
  const campaign = (await jsonSnapshot<CampaignDraft>(DRAFT_PREFIX + id)).value;
  if (!campaign) return null;
  const evidence = (await redis.lrange(EVIDENCE_PREFIX + id, 0, -1)).map(v => parse<CompanyEvidence>(v));
  const snapshot = await jsonSnapshot<Record<string, ContributionThread>>(RESPONSE_PREFIX + id);
  return { campaign, evidence, snapshot, threads: snapshot.value || {} };
}
export async function contributionView(id: string, wallet: string | null) {
  const c = await context(id); if (!c || c.campaign.hiddenAt || (c.campaign.status === 'draft' && c.campaign.owner !== wallet?.toLowerCase())) return null;
  const owner = c.campaign.owner === wallet?.toLowerCase();
  const cards: ContributionCard[] = c.evidence.filter(e => owner || (!!wallet && e.contributorWallet === wallet.toLowerCase())).map(e => {
    const thread = c.threads[e.id] || EMPTY_THREAD;
    const waiting = awaitingCompany(e.at, thread);
    return { id: e.id, note: e.note, at: e.at, verdict: e.verdict, thread, role: owner ? 'company' : 'contributor', canReply: !!e.contributorWallet && /^0x[0-9a-f]{40}$/i.test(e.contributorWallet), replyBy: waiting && c.campaign.reviewWithinHours ? new Date(Date.parse(waiting) + c.campaign.reviewWithinHours * 3600000).toISOString() : null };
  });
  const reveals: ContributionReveal[] = c.campaign.status === 'published' ? c.evidence.flatMap(e => {
    const thread = c.threads[e.id]; const response = thread?.responses.at(-1);
    return response?.status === 'used' && response.evidenceUrl && thread.consent?.responseAt === response.at ? [{ id: e.id, response, credit: thread.consent.credit }] : [];
  }) : [];
  return { cards, reveals, owner, company: c.campaign.company, intakePaused: isOverdue(c.campaign, c.evidence, c.threads), reviewWithinHours: c.campaign.reviewWithinHours || null };
}
export function isOverdue(campaign: Pick<CampaignDraft, 'reviewWithinHours'>, evidence: CompanyEvidence[], threads: Record<string, ContributionThread>, now = Date.now()): boolean {
  if (!campaign.reviewWithinHours) return false; // Never invent a deadline for a legacy campaign.
  return evidence.some(e => { const waiting = awaitingCompany(e.at, threads[e.id] || EMPTY_THREAD); return !!waiting && Date.parse(waiting) + campaign.reviewWithinHours! * 3600000 < now; });
}
export async function campaignIntakePaused(id: string) { const c = await context(id); return c ? isOverdue(c.campaign, c.evidence, c.threads) : true; }
export function changeThread(thread: ContributionThread, role: 'company' | 'contributor', body: Record<string, unknown>, now: number): ContributionThread {
  if (body.version !== thread.version) throw new Error('This work changed. Reload before responding.');
  const next: ContributionThread = structuredClone(thread); const at = new Date(now).toISOString();
  if (body.action === 'respond' && role === 'company') {
    const statuses = ['acknowledged', 'revision_requested', 'not_selected', 'used'];
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!statuses.includes(String(body.status)) || message.length < 20 || message.length > 2000) throw new Error('Choose a response and explain it in 20 to 2,000 characters.');
    const response: CompanyResponse = { status: body.status as CompanyResponse['status'], message, at };
    if (response.status === 'used') {
      const before = typeof body.before === 'string' ? body.before.trim() : '';
      const after = typeof body.after === 'string' ? body.after.trim() : '';
      const url = evidenceUrl(body.evidenceUrl);
      if (before.length < 10 || after.length < 10 || before.length > 1000 || after.length > 1000 || !url) throw new Error('Describe before and after (10 to 1,000 characters each), and link to the actual use.');
      Object.assign(response, { before, after, evidenceUrl: url });
    }
    next.responses.push(response); delete next.consent; // Consent binds one exact response, never a future edit.
  } else if (body.action === 'revise' && role === 'contributor') {
    if (next.responses.at(-1)?.status !== 'revision_requested' || awaitingCompany('', thread)) throw new Error('Wait for the company to request a revision.');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length < 20 || note.length > 4000) throw new Error('Write the revision in 20 to 4,000 characters.');
    next.revisions.push({ note, at }); delete next.consent;
  } else if (body.action === 'consent' && role === 'contributor') {
    if (body.allow === false) delete next.consent;
    else {
      const response = next.responses.at(-1); const credit = typeof body.credit === 'string' ? body.credit.trim() : '';
      if (response?.status !== 'used' || !response.evidenceUrl || !credit || credit.length > 80 || /^0x[0-9a-f]{40}$/i.test(credit)) throw new Error('Choose a display name after the company records actual use.');
      next.consent = { responseAt: response.at, credit };
    }
  } else throw new Error('That action is not available to this account.');
  next.version += 1; return next;
}
export const SAVE_RESPONSE = `local v=redis.call('GET',KEYS[1]); if (v and redis.sha1hex(v) or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`;
export async function saveContributionResponse(id: string, wallet: string, body: Record<string, unknown>, now = Date.now()) {
  const c = await context(id); if (!c) return { status: 404, error: 'Campaign not found.' };
  const evidence = c.evidence.find(e => e.id === body.evidenceId); if (!evidence) return { status: 404, error: 'Contribution not found.' };
  if (!evidence.contributorWallet || !/^0x[0-9a-f]{40}$/i.test(evidence.contributorWallet)) return { status: 409, error: 'This older record has no authenticated contributor link. A response cannot be delivered.' };
  const address = wallet.toLowerCase(); const role = c.campaign.owner === address ? 'company' : evidence.contributorWallet === address ? 'contributor' : null;
  if (!role) return { status: 404, error: 'Contribution not found.' };
  let thread: ContributionThread;
  try { thread = changeThread(c.threads[evidence.id] || EMPTY_THREAD, role, body, now); } catch (e) { return { status: 409, error: (e as Error).message }; }
  const threads = { ...c.threads, [evidence.id]: thread };
  if (!await getRedis()!.eval(SAVE_RESPONSE, [RESPONSE_PREFIX + id], [c.snapshot.hash, JSON.stringify(threads)])) return { status: 409, error: 'Another response arrived. Reload before saving.' };
  return { status: 200, thread };
}
