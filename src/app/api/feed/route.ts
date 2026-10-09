import { NextResponse } from "next/server";
import { listCampaignResults, listPublishedCampaigns } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { escrowV2Address } from "@/lib/escrow-v2";
import { feedCards, type FavourDetail, type FeedPage } from "@/lib/feed";
import { firstPage } from "@/lib/first-page";
import { fetchLaunches } from "@/lib/launch-feed";
import { fetchProduct, type FetchResult } from "@/lib/product-fetch";
import { CANDIDATES, tallies, voteRows } from "@/lib/product-votes";
import { feedbackRound } from "@/lib/project-view";
import { getTask } from "@/lib/store";

// GET /api/feed -> the first tab in one read: the first page (`/api/top`'s
// shape, so the hunt's stamps keep working) plus one card per project for the
// feed (lib/feed.ts). Public, cached for a minute. Nothing private: the vote
// counts are the public tallies, and "mine" stays on /api/votes.
//
// Read-only. The product on FAVOUR gives its ask, its feedback round and its
// review piece's task; the task is read as stored and judged by reward.ts. The
// escrow address for a funded v2 task is the one pinned on the task, else the
// config address from lib/escrow-v2.ts. The outside pages are read through the
// fence in lib/product-fetch.ts and kept for ten minutes, like the other routes.

const KEEP_MS = 10 * 60_000;
const pages = new Map<string, { at: number; result: FetchResult }>();

async function page(url: string, now: number): Promise<FetchResult> {
  const kept = pages.get(url);
  if (kept && now - kept.at < KEEP_MS) return kept.result;
  const result = await fetchProduct(url).catch((): FetchResult => ({ ok: false, reason: "unreadable" }));
  pages.set(url, { at: result.ok ? now : now - KEEP_MS + 60_000, result });
  return result;
}

export async function GET() {
  const now = Date.now();
  try {
    // One database pass: the campaign list and each result list are read once
    // and shared by the first page and the feed's details.
    const campaigns = listPublishedCampaigns(50);
    const results = new Map<string, ReturnType<typeof listCampaignResults>>();
    const resultsOf = (id: string) => {
      let p = results.get(id);
      if (!p) { p = listCampaignResults(id); results.set(id, p); }
      return p;
    };
    const [first, list, votes] = await Promise.all([
      firstPage({ campaigns: () => campaigns, results: resultsOf, picture: getPictureRecord, launches: (n) => fetchLaunches(n), readPage: (url) => page(url, now) }, now),
      campaigns,
      Promise.all([
        Promise.all(CANDIDATES.map(async (c) => [c.id, await page(c.url, now)] as const)).then(Object.fromEntries),
        tallies(null).catch(() => ({})),
      ]).then(([read, tally]) => voteRows(read, tally)).catch(() => []),
    ]);

    const escrowAddress = escrowV2Address();
    const details: Record<string, FavourDetail> = {};
    await Promise.all(list.map(async (c) => {
      if (!first.top.rows.some((r) => r.id === c.id)) return;
      const [rows, task] = await Promise.all([
        resultsOf(c.id).catch(() => []),
        c.pieceTaskIds?.review ? getTask(c.pieceTaskIds.review).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const round = feedbackRound(c, rows);
      details[c.id] = {
        ask: round.ask,
        accepted: round.accepted,
        acceptedIsFloor: round.acceptedIsFloor,
        target: round.target,
        task: task ? { rewardType: task.rewardType, bountyUsdc: task.bountyUsdc, escrowTxHash: task.escrowTxHash, onChainId: task.onChainId, escrowV2Address: task.escrowV2Address ?? null } : null,
        escrowAddress,
      };
    }));

    const body: FeedPage = { ...first, cards: feedCards(first, votes, details) };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "The feed could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
