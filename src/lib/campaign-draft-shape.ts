// The shape of a company campaign draft, safe to import from client components.
// The store logic lives in campaign-drafts.ts, which is server-only because it
// talks to Redis. See that file for what a draft is and what it can never do.

export const PIECE_KINDS = ["ugc", "article", "review"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];
export const PIECE_LABEL: Record<PieceKind, string> = {
  ugc: "A short UGC clip",
  article: "A short article",
  review: "An honest review",
};

export type ReviewRule = "ai" | "ai_and_jury";

export type CampaignDraft = {
  id: string;
  // "draft": private to the company, nothing on the board.
  // "published": its pieces are live POINTS favours anyone can join. The pool is
  // still only proposed; there is no funded state in this type on purpose.
  // "publishing": publish started and not every piece exists yet. Resumable: a
  // retry creates only the missing pieces. The pieces already made keep their
  // campaign identity (2026-09-21 fix: a failure on piece 2 of 3 used to leave
  // unlabelled pieces and burn the day's publish, with no way to finish).
  status: "draft" | "publishing" | "published";
  company: string;
  brief: string;
  pieces: Array<{ kind: PieceKind; count: number }>;
  // Points paid per accepted piece. The points band is the same 1-10 as any
  // points favour.
  rewardPerPiecePoints: number;
  // A PROPOSAL in USDC. Display only. Never a pot, never a balance.
  proposedPoolUsdc: number;
  reviewRule: ReviewRule;
  owner: string; // lowercased wallet from the session, never from the body
  createdAt: string;
  publishedAt?: string;
  // The board task that carries each kind of piece, once published.
  pieceTaskIds?: Partial<Record<PieceKind, string>>;
};

// What anyone may read about a PUBLISHED company campaign. No owner address here:
// the company is named by the name it chose.
export type PublicCompanyCampaign = Pick<
  CampaignDraft,
  "id" | "company" | "brief" | "pieces" | "rewardPerPiecePoints" | "proposedPoolUsdc" | "reviewRule" | "publishedAt" | "pieceTaskIds"
> & { status: "publishing" | "published" };

export type CampaignResult = {
  taskId: string;
  kind: PieceKind | null;
  verdict: "pass" | "fail" | "flag";
  reason: string;
  participant: string; // shortened, never the full address
  at: string;
};

