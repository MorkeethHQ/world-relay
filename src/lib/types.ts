export type TaskStatus = "open" | "claimed" | "completed" | "failed" | "expired";

export type TaskCategory = "photo" | "delivery" | "check-in" | "custom";

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
};

export type AgentInfo = {
  id: string;
  name: string;
  icon: string;
  color: string;
};

export type AiFollowUp = {
  question: string;
  status: "pending" | "resolved";
  initialConfidence: number;
};

export type RecurringConfig = {
  intervalHours: number;
  totalRuns: number;
  completedRuns: number;
  parentTaskId: string | null;
};

export type Task = {
  id: string;
  poster: string;
  claimant: string | null;
  category: TaskCategory;
  description: string;
  location: string;
  lat: number | null;
  lng: number | null;
  bountyUsdc: number;
  deadline: string;
  status: TaskStatus;
  proofImageUrl: string | null;
  proofNote: string | null;
  verificationResult: VerificationResult | null;
  attestationTxHash: string | null;
  agent: AgentInfo | null;
  aiFollowUp: AiFollowUp | null;
  recurring: RecurringConfig | null;
  createdAt: string;
};
