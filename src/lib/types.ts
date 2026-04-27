export type TaskStatus = "open" | "claimed" | "completed" | "failed" | "expired";

export type TaskCategory = "photo" | "delivery" | "check-in" | "custom" | "feedback";

export type TaskType = "standard" | "double-or-nothing";

export type ModelVerdict = {
  name: string;
  verdict: "pass" | "flag" | "fail";
  confidence: number;
  reasoning: string;
};

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
  models?: ModelVerdict[];
  consensusMethod?: "majority" | "unanimous";
};

export type AgentInfo = {
  id: string;
  name: string;
  icon: string;
  color: string;
  verificationPrompt?: string;
  personality?: string;
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
  proofImages: string[] | null;
  proofNote: string | null;
  verificationResult: VerificationResult | null;
  attestationTxHash: string | null;
  agent: AgentInfo | null;
  aiFollowUp: AiFollowUp | null;
  recurring: RecurringConfig | null;
  callbackUrl: string | null;
  onChainId: number | null;
  escrowTxHash: string | null;
  claimCode: string | null;
  taskType: TaskType;
  donOnChainId: number | null;
  donStakeTxHash: string | null;
  claimantVerification?: "orb" | "device" | "wallet" | null;
  requiresClaim: boolean;
  createdAt: string;
};
