export type CompanyResponse = { status: 'acknowledged' | 'revision_requested' | 'not_selected' | 'used'; message: string; before?: string; after?: string; evidenceUrl?: string; at: string };
export type ContributionThread = { version: number; responses: CompanyResponse[]; revisions: Array<{ note: string; at: string }>; consent?: { responseAt: string; credit: string } };
export type ContributionCard = { id: string; note: string; at: string; verdict: string; thread: ContributionThread; role: 'company' | 'contributor'; canReply: boolean; replyBy: string | null };
export type ContributionReveal = { id: string; response: CompanyResponse; credit: string };
export const EMPTY_THREAD: ContributionThread = { version: 0, responses: [], revisions: [] };
export const RESPONSE_LABELS = { acknowledged: 'Read and answered', revision_requested: 'A revision would help', not_selected: 'Not selected', used: 'Used in our work' };
export function awaitingCompany(at: string, thread: ContributionThread): string | null {
  const response = thread.responses.at(-1);
  const revision = thread.revisions.at(-1);
  return !response ? at : revision && revision.at > response.at ? revision.at : null;
}
