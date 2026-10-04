export type CompanyAppeal = {
  id: string; taskId: string; campaignId: string; company: string;
  owner: string; participant: string; description: string; note: string; images: string[];
  aiReason: string; at: string; decidedAt?: string;
  votes: Array<{ judge: string; real: boolean; reason: string; at: string }>;
  outcome: "pending" | "cleared" | "upheld"; points: number;
};
export type CompanyAppealHistory = Omit<CompanyAppeal, "owner" | "participant" | "votes" | "images" | "outcome"> & {
  outcome: CompanyAppeal["outcome"] | "superseded";
  role: "company" | "contributor";
  votes: Array<{ real: boolean; reason: string; at: string }>;
};
