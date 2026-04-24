export type TaskStatus = "open" | "claimed" | "completed" | "failed" | "expired";

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
};

export type Task = {
  id: string;
  poster: string;
  claimant: string | null;
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
  createdAt: string;
};
