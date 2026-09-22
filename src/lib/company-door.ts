// THE COMPANY DOOR (T3, 2026-09-22). The first screen's main action is "Do a piece
// and earn". The company path sits behind a quieter "For companies". Shared by the
// signed-out first screen and the board, so both pick the same campaign.
import type { Task } from "./types";
import type { PublicCompanyCampaign } from "./campaign-draft-shape";
import { PIECE_KINDS, hasProduct } from "./campaign-draft-shape";

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

// The campaign "Do a piece and earn" opens: a checked company first, then the
// longest-running campaign, among those that name their product and have a piece
// open. Null when none is open.
export function pickCampaignToDo(
  campaigns: PublicCompanyCampaign[],
  tasks: Task[],
  completedIds: Set<string> = new Set(),
): { campaign: PublicCompanyCampaign; openPieces: number; totalOpen: number } | null {
  // A campaign that has not named its product is not offered: a participant
  // cannot tell what to make a piece about (Grok's walk, 22 Sep).
  const open = campaigns
    .filter((c) => hasProduct(c))
    .map((c) => ({ c, n: openPiecesOf(c, tasks, completedIds) }))
    .filter((x) => x.n > 0)
    .sort((a, b) =>
      Number(b.c.companyChecked) - Number(a.c.companyChecked) ||
      (a.c.publishedAt ?? "").localeCompare(b.c.publishedAt ?? ""));
  if (open.length === 0) return null;
  return { campaign: open[0].c, openPieces: open[0].n, totalOpen: open.reduce((s, x) => s + x.n, 0) };
}

// The host of a product link, for display. The link comes from an unverified
// company, so the UI shows where it goes before anyone taps it.
export function productHost(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}
