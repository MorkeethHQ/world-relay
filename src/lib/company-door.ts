// THE COMPANY DOOR (T3, 2026-09-22). The first screen's main action is "Do a piece
// and earn". The company path sits behind a quieter "For companies". Shared by the
// signed-out first screen and the board, so both pick the same campaign.
import type { Task } from "./types";
import type { PublicCompanyCampaign } from "./campaign-draft-shape";
import { PIECE_KINDS, publishGateReason } from "./campaign-draft-shape";
import { looksLikeSpam } from "./board-rank";

// Pieces of this campaign a person can still do: the task exists, is open, has
// room, and this person has not delivered it.
export function openPiecesOf(c: PublicCompanyCampaign, tasks: Task[], completedIds: Set<string> = new Set()): number {
  let n = 0;
  for (const k of PIECE_KINDS) {
    const id = c.pieceTaskIds?.[k];
    if (!id || completedIds.has(id)) continue;
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status !== "open") continue;
    const want = c.pieces.find((p) => p.kind === k)?.count ?? 0;
    n += Math.max(0, (t.maxCompletions || want) - (t.completionCount || 0));
  }
  return n;
}

// One order for every campaign surface: a checked company first, then the
// longest-running campaign.
export function campaignOrder(a: PublicCompanyCampaign, b: PublicCompanyCampaign): number {
  return Number(b.companyChecked) - Number(a.companyChecked) || (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "");
}

// The campaign "Do a piece and earn" opens: the longest-running campaign among
// those that may lead (R16, canLeadCampaign below). Null when none may, and then
// the card is not shown at all.
export function pickCampaignToDo(
  campaigns: PublicCompanyCampaign[],
  tasks: Task[],
  completedIds: Set<string> = new Set(),
): { campaign: PublicCompanyCampaign; openPieces: number; totalOpen: number } | null {
  // A campaign that has not named its product is not offered: a participant
  // cannot tell what to make a piece about (Grok's walk, 22 Sep).
  // R16 (2026-09-25): "Do a piece and earn" is the first card a signed-out
  // stranger sees, so it offers only a campaign that may lead: checked company,
  // a real brief and product, not hidden, a piece open. hasProduct is part of the
  // publish gate inside canLeadCampaign.
  const open = campaigns
    .filter((c) => canLeadCampaign(c, tasks, completedIds))
    .map((c) => ({ c, n: openPiecesOf(c, tasks, completedIds) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => campaignOrder(a.c, b.c));
  if (open.length === 0) return null;
  return { campaign: open[0].c, openPieces: open[0].n, totalOpen: open.reduce((s, x) => s + x.n, 0) };
}

// The host of a product link, for display. The link comes from an unverified
// company, so the UI shows where it goes before anyone taps it.
export function productHost(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

// R16, WHAT MAY LEAD THE BOARD (2026-09-25). A stranger test found the first card a
// new visitor saw was an unverified campaign whose brief read "just want to make
// money" and whose pieces nobody could join, because it names no product. Trust
// was gone in 12 seconds. A campaign card may sit ABOVE the favour list only when
// all of these hold:
//   - it is not hidden by the operator (scripts/hide-item.mjs),
//   - FAVOUR has checked the company by hand (companyChecked),
//   - it would pass today's publish gate: a brief of MIN_BRIEF_WORDS words, a named
//     product and a product link (publishGateReason is null). A 5-word brief such
//     as "just want to make money" fails this on its own,
//   - its brief and name do not read as a money pitch (looksLikeSpam),
//   - the viewer can do at least one piece of it now (openPiecesOf > 0).
// Every other campaign that is not hidden goes BELOW the favour list, still
// labelled with its trust. It is demoted, not dropped. The only thing that removes
// a campaign from the board is the operator's hidden state.
export function canLeadCampaign(
  c: PublicCompanyCampaign,
  tasks: Task[],
  completedIds: Set<string> = new Set(),
): boolean {
  return (
    !c.hidden &&
    c.companyChecked &&
    publishGateReason(c) === null &&
    !looksLikeSpam(c.brief) &&
    !looksLikeSpam(c.company) &&
    openPiecesOf(c, tasks, completedIds) > 0
  );
}

export function rankCampaignCards(
  campaigns: PublicCompanyCampaign[],
  tasks: Task[],
  completedIds: Set<string> = new Set(),
): { lead: PublicCompanyCampaign[]; rest: PublicCompanyCampaign[] } {
  const visible = campaigns.filter((c) => !c.hidden).sort(campaignOrder);
  const lead = visible.filter((c) => canLeadCampaign(c, tasks, completedIds));
  const rest = visible.filter((c) => !lead.includes(c));
  return { lead, rest };
}
