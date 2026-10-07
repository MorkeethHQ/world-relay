import type { CampaignResult, CampaignDraft } from "./campaign-draft-shape";

export type CompanyEvidence = CampaignResult & { id: string; contributorWallet?: string; note: string; images: string[]; reviewReasons?: string[] };
export type CompanyDecision = { id: string; question: string; decision: string; evidenceIds: string[]; at: string };
export type CompanyReview = {
  campaign: Pick<CampaignDraft, "id" | "company" | "brief" | "status" | "productName" | "productUrl">;
  evidence: CompanyEvidence[];
  decisions: CompanyDecision[];
};

export function evidenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
