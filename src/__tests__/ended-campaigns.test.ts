import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Task } from "@/lib/types";
import type { PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import { rankCampaignCards, campaignEnded } from "@/lib/company-door";
import { getFeaturedCampaign, isCampaignRunning, getCampaign } from "@/lib/campaigns";
import { rankBoard, boardTier, TIER } from "@/lib/board-rank";

// R18 (2026-10-04). LOCAL FIXTURES, not live data. The two campaigns and the six
// piece tasks below are copied from what production served on 4 Oct 2026
// (GET /api/campaigns/company and GET /api/tasks, 20:35 UTC): both campaigns still
// listed under "More company campaigns", every piece expired on 28 or 29 Sep with
// 0 accepted pieces.
const NOW = Date.parse("2026-10-04T20:35:44Z");

const LIVE: PublicCompanyCampaign[] = [
  {
    id: "draft_02e1e94c-fd35-4d27-bd8b-fa863838e3f8", company: "MDM Enterprise", brief: "Make short video about product",
    status: "published", companyChecked: false, publishedAt: "2026-09-22T05:05:13.180Z",
    pieceTaskIds: { ugc: "0e9c74d3", article: "e8bf9b8b", review: "26c9e2e1" },
    pieces: [{ kind: "ugc", count: 5 }, { kind: "article", count: 2 }, { kind: "review", count: 10 }],
    rewardPerPiecePoints: 10, proposedPoolUsdc: 200, reviewRule: "ai_and_jury",
  },
  {
    id: "draft_76481794-e040-4050-b8a4-30829e7b9e96", company: "Filipino Lokal",
    brief: "Honest content about Filipino local products and small businesses, made by real customers sharing their genuine experiences. Simple, natural, and suitable for UGC, articles, and honest reviews.",
    status: "published", companyChecked: false, publishedAt: "2026-09-21T17:05:13.679Z",
    pieceTaskIds: { ugc: "e80a8417", article: "a41f18d6", review: "1c1dd7a2" },
    pieces: [{ kind: "ugc", count: 5 }, { kind: "article", count: 5 }, { kind: "review", count: 10 }],
    rewardPerPiecePoints: 10, proposedPoolUsdc: 200, reviewRule: "ai_and_jury",
  },
];

function piece(id: string, companyCampaignId: string, o: Partial<Task> = {}): Task {
  return {
    id, poster: "0xowner", claimant: null, category: "review", description: `${id} piece`, location: "Anywhere",
    lat: null, lng: null, bountyUsdc: 10, deadline: "2026-09-29T05:05:13.219Z", status: "expired",
    rewardType: "points", maxCompletions: 5, completionCount: 0, createdAt: "2026-09-22T05:05:13.000Z",
    onChainId: null, escrowTxHash: null, companyCampaignId, ...o,
  } as Task;
}

const expiredPieces: Task[] = [
  piece("0e9c74d3", LIVE[0].id), piece("e8bf9b8b", LIVE[0].id), piece("26c9e2e1", LIVE[0].id),
  piece("e80a8417", LIVE[1].id, { deadline: "2026-09-28T17:05:13.704Z" }),
  piece("a41f18d6", LIVE[1].id, { deadline: "2026-09-28T17:05:13.716Z" }),
  piece("1c1dd7a2", LIVE[1].id, { deadline: "2026-09-28T17:05:13.727Z" }),
];

describe("R18: a company campaign whose pieces have all closed is history, not a card", () => {
  it("both live campaigns are ended and leave the board list", () => {
    const { lead, rest, ended } = rankCampaignCards(LIVE, expiredPieces, new Set(), NOW);
    expect(lead).toEqual([]);
    expect(rest).toEqual([]);
    expect(ended.map((c) => c.company).sort()).toEqual(["Filipino Lokal", "MDM Enterprise"]);
  });

  it("one open piece keeps a campaign on the board", () => {
    const tasks = expiredPieces.map((t) => (t.id === "26c9e2e1" ? { ...t, status: "open", deadline: "2026-10-10T00:00:00Z" } as Task : t));
    expect(campaignEnded(LIVE[0], tasks, NOW)).toBe(false);
    const { rest, ended } = rankCampaignCards(LIVE, tasks, new Set(), NOW);
    expect(rest.map((c) => c.company)).toEqual(["MDM Enterprise"]);
    expect(ended.map((c) => c.company)).toEqual(["Filipino Lokal"]);
  });

  it("a claimed piece is work in flight, so the campaign has not ended", () => {
    const tasks = expiredPieces.map((t) => (t.id === "e80a8417" ? { ...t, status: "claimed", claimant: "0xa" } as Task : t));
    expect(campaignEnded(LIVE[1], tasks, NOW)).toBe(false);
  });

  it("an open piece past its deadline counts as closed (the cron has not run yet)", () => {
    const tasks = expiredPieces.map((t) => ({ ...t, status: "open" }) as Task);
    expect(campaignEnded(LIVE[0], tasks, NOW)).toBe(true);
  });

  it("unknown is not ended: pieces not in the list keep the card (tasks still loading)", () => {
    expect(campaignEnded(LIVE[0], [], NOW)).toBe(false);
    const { rest, ended } = rankCampaignCards(LIVE, [], new Set(), NOW);
    expect(rest).toHaveLength(2);
    expect(ended).toEqual([]);
  });

  it("an operator hidden campaign is in no list at all", () => {
    const { lead, rest, ended } = rankCampaignCards([{ ...LIVE[0], hidden: true }], expiredPieces, new Set(), NOW);
    expect([...lead, ...rest, ...ended]).toEqual([]);
  });

  it("the campaign page says it has ended", () => {
    const src = readFileSync("src/components/CompanyCampaign.tsx", "utf8");
    expect(src).toContain("campaignEnded(c, tasks)");
    expect(src).toContain("This campaign has ended.");
  });
});

describe("R18: the featured house campaign is one that is still running", () => {
  it("on 4 Oct the featured campaign is the welcome journey, not the one that ended on 30 Sep", () => {
    expect(getFeaturedCampaign(NOW)?.id).toBe("first-favour");
  });

  it("before 30 Sep it was the comeback campaign", () => {
    expect(getFeaturedCampaign(Date.parse("2026-09-15T00:00:00Z"))?.id).toBe("comeback-2026");
  });

  it("when every featured campaign has ended there is none", () => {
    expect(getFeaturedCampaign(Date.parse("2027-01-05T00:00:00Z"))).toBeNull();
  });

  it("isCampaignRunning reads endsAt", () => {
    expect(isCampaignRunning(getCampaign("comeback-2026")!, NOW)).toBe(false);
    expect(isCampaignRunning(getCampaign("first-favour")!, NOW)).toBe(true);
  });

  it("a welcome journey favour ranks in the FEATURED tier on the board", () => {
    const base = { status: "open", claimant: null, rewardType: "points", bountyUsdc: 5, category: "photo", description: "d", maxCompletions: 1000, completionCount: 2, deadline: "2027-07-05T00:00:00Z", onChainId: null, escrowTxHash: null } as unknown as Task;
    const welcome = { ...base, id: "w", createdAt: "2026-07-05T00:00:00Z", campaignId: "first-favour" } as Task;
    const plain = { ...base, id: "p", createdAt: "2026-10-04T00:00:00Z", maxCompletions: 100 } as Task;
    const ranked = rankBoard([plain, welcome], { userId: null, userLocation: null, now: NOW });
    expect(ranked.map((t) => t.id)).toEqual(["w", "p"]);
    expect(boardTier(welcome, null, getFeaturedCampaign(NOW)!.id, NOW)).toBe(TIER.FEATURED);
  });
});
