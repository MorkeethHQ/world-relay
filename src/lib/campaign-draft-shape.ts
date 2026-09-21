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

// THE PIECE CAP while a pool is only proposed (ruling 2026-09-21, from the
// publish-limit review of #19). Any World App wallet may publish, so the cap bounds
// what one campaign can put on the board: at most 10 pieces of any kind and 20 in
// total, so at most 20 x 10 = 200 points per campaign instead of 3 x 50 x 10 =
// 1,500. The default plan, 5 UGC + 2 articles + 10 reviews = 17, fits.
export const MAX_PIECES_PER_KIND = 10;
export const MAX_PIECES_TOTAL = 20;

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

