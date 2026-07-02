export type TaskStatus = "open" | "claimed" | "completed" | "failed" | "expired" | "cancelled";

export type TaskCategory = "photo" | "delivery" | "check-in" | "custom" | "feedback" | "review" | "social" | "errand";

export type TaskType = "standard" | "double-or-nothing";

export type RewardType = "usdc" | "points";

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
  // Optional link to a Campaign (see lib/campaigns.ts). When set, the task only
  // shows up under that campaign. Absent on standalone tasks and legacy data.
  campaignId?: string;
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
  rewardType: RewardType;
  donOnChainId: number | null;
  donStakeTxHash: string | null;
  claimantVerification?: "orb" | "device" | "wallet" | null;
  requiresClaim: boolean;
  // Settlement tracking. pendingRelease=true means the proof verified (pass) but
  // the USDC payout has NOT been confirmed on-chain yet — the task is done but not
  // paid, and the reconciliation cron (/api/cron/reconcile-settlements) will retry.
  // settlementTx is the confirmed forward tx hash once the payout lands.
  pendingRelease: boolean;
  settlementTx?: string | null;
  maxCompletions: number;
  completionCount: number;
  createdAt: string;
};
