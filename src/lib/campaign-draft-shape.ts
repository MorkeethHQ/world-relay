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

// What each kind of piece asks the participant to do, and what their proof is. Shared
// by the server (the task description) and the proof screen, which shows the ask on
// its own line instead of at the end of a pasted brief (2026-09-21 walk).
export const PIECE_ASK: Record<PieceKind, string> = {
  ugc: "Make a short clip about it and post it where people will see it. Send the link.",
  article: "Write a short article about it and publish it. Send the link.",
  review: "Try it and write an honest review, the real verdict. Send the link or the text.",
};
export const PIECE_PROOF_HINT: Record<PieceKind, string> = {
  ugc: "Paste the link to your clip",
  article: "Paste the link to your article",
  review: "Paste the link, or write your review here",
};

// THE PIECE CAP while a pool is only proposed (ruling 2026-09-21, from the
// publish-limit review of #19). Any World App wallet may publish, so the cap bounds
// what one campaign can put on the board: at most 10 pieces of any kind and 20 in
// total, so at most 20 x 10 = 200 points per campaign instead of 3 x 50 x 10 =
// 1,500. The default plan, 5 UGC + 2 articles + 10 reviews = 17, fits.
export const MAX_PIECES_PER_KIND = 10;
export const MAX_PIECES_TOTAL = 20;

export type ReviewRule = "ai" | "ai_and_jury";

// THE COMPANY DOOR (T3, 2026-09-22). Any World App wallet may publish, and two
// wallets published campaigns with briefs like "just want to make money". So a
// publish needs a real brief (20 words) and a link to the product, and every
// campaign reads "Unverified company" until Oscar has checked it by hand
// (scripts/mark-company-checked.mjs). Nothing here touches money.
export const MIN_BRIEF_WORDS = 20;
export function briefWords(brief: string): number {
  return brief.trim().split(/\s+/).filter(Boolean).length;
}
// An http(s) link with a real host name. Returns the normalised URL or null.
export function productUrlOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (raw.length === 0 || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  return u.toString();
}
// Why a draft may not be published yet, or null. One rule for the form, the
// server's save and the server's publish.
export function publishGateReason(d: { brief: string; productUrl?: string | null }): string | null {
  const n = briefWords(d.brief);
  if (n < MIN_BRIEF_WORDS) return `Describe what you want made in at least ${MIN_BRIEF_WORDS} words. This brief has ${n}.`;
  if (!productUrlOrNull(d.productUrl)) return "Add a link to your product, so people know what they are making a piece about.";
  return null;
}

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
  // A link to the product. Required to publish since 2026-09-22 (T3). The three
  // campaigns published before that have none and stay live, unverified.
  productUrl?: string;
  // Set ONLY by Oscar, by hand, through scripts/mark-company-checked.mjs. No API
  // route writes it and validateDraftInput never copies it from a body.
  companyCheckedAt?: string;
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
  "id" | "company" | "brief" | "pieces" | "rewardPerPiecePoints" | "proposedPoolUsdc" | "reviewRule" | "publishedAt" | "pieceTaskIds" | "productUrl"
> & { status: "publishing" | "published"; companyChecked: boolean };

export type CampaignResult = {
  taskId: string;
  kind: PieceKind | null;
  verdict: "pass" | "fail" | "flag";
  reason: string;
  participant: string; // shortened, never the full address
  at: string;
};

