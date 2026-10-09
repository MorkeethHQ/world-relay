import { describe, expect, it } from "vitest";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";
import type { RankedCampaign } from "@/lib/rank-campaigns";
import { actionOf, ASK_MAX, contractLine, contractOf, feedCards, reviewOf, rewardOf, shortAddress, sourceText, type FavourDetail, type ReviewTask } from "@/lib/feed";

// THE MAIN FEED (9 Oct 2026): one card per project. The reward is written by
// reward.ts alone, USDC appears only on a funded task, the contract line names an
// escrow only when the stored fund tx has the verified shape, and the review share
// exists only when the campaign holds a target. Funded first, points next, then
// the rest in rail order.

const row = (over: Partial<RankedCampaign> & { id: string }): RankedCampaign => ({
  rank: 1, name: over.id, company: "co", productUrl: `https://${over.id}.app/`, points: 20, acceptedToday: 0, acceptedTotal: 0, reviewedTotal: 0,
  publishedAt: "2026-10-09T00:00:00Z", makerChecked: false, totalIsFloor: false, ...over,
});

const page = (rows: RankedCampaign[], launches: FirstPage["launches"] = []): FirstPage => ({
  top: { rows, products: rows.length, waiting: 0, acceptedToday: 0, acceptedTotal: 0, rankedBy: "newest" },
  launches,
  pictures: {},
  at: "2026-10-09T00:00:00Z",
});

const launch = (id: string, score: number): FirstPage["launches"][number] => ({
  rank: 1, id, name: `Launch ${id}`, line: "A line", url: `https://${id}.example/`, source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=1", score, comments: 0, at: "2026-10-09T00:00:00Z",
});

const vote = (id: string, votes: number | null = null): VoteRow => ({ id, name: id, line: null, url: `https://${id}.vercel.app/`, host: `${id}.vercel.app`, image: null, icon: null, votes, mine: false });

const pointsTask: ReviewTask = { rewardType: "points", bountyUsdc: 20, escrowTxHash: null, onChainId: null, escrowV2Address: null };
const HASH = `0x${"ab".repeat(32)}`;
const PINNED = "0x1111111111111111111111111111111111111111";
const CONFIG = "0x2222222222222222222222222222222222222222";
const fundedV2: ReviewTask = { rewardType: "usdc-v2", bountyUsdc: 5, escrowTxHash: HASH, onChainId: null, escrowV2Address: PINNED };

const detail = (over: Partial<FavourDetail> = {}): FavourDetail => ({ ask: "Try the onboarding and say where you got stuck", accepted: 3, acceptedIsFloor: false, target: 5, task: pointsTask, ...over });

describe("sourceText", () => {
  it("names the source with its own number for a launch, the list for a candidate, the maker otherwise", () => {
    expect(sourceText({ kind: "launch", name: "Hacker News", score: 52 })).toBe("Hacker News · 52");
    expect(sourceText({ kind: "vote" })).toBe("Vote list");
    expect(sourceText({ kind: "maker" })).toBe("Posted by its maker");
  });
});

describe("rewardOf: reward.ts alone", () => {
  it("writes points as pts", () => {
    expect(rewardOf(pointsTask)).toBe("20 pts");
  });
  it("writes USDC only when the existing rule says the task is real money", () => {
    expect(rewardOf(fundedV2)).toBe("$5 USDC");
    expect(rewardOf({ ...fundedV2, escrowTxHash: null, onChainId: null })).toBeNull(); // posted, not funded
  });
});

describe("contractOf", () => {
  it("is points for a points favour", () => {
    expect(contractOf(pointsTask)).toEqual({ kind: "points" });
  });
  it("is escrow with the pinned address for a funded v2 task whose fund tx has the verified shape", () => {
    expect(contractOf(fundedV2, CONFIG)).toEqual({ kind: "escrow", usdc: 5, address: PINNED });
  });
  it("falls back to the config address when no address was pinned", () => {
    expect(contractOf({ ...fundedV2, escrowV2Address: null }, CONFIG)).toEqual({ kind: "escrow", usdc: 5, address: CONFIG });
    expect(contractOf({ ...fundedV2, escrowV2Address: null })).toEqual({ kind: "escrow", usdc: 5, address: null });
  });
  it("never names an escrow for a placeholder hash, an unfunded v2 task, or a v1 task", () => {
    expect(contractOf({ ...fundedV2, escrowTxHash: "funded" })).toBeNull();
    expect(contractOf({ ...fundedV2, escrowTxHash: null })).toBeNull();
    expect(contractOf({ rewardType: "usdc", bountyUsdc: 5, escrowTxHash: HASH, onChainId: 7, escrowV2Address: null })).toBeNull();
  });
});

describe("reviewOf", () => {
  it("gives the progress line from project-view and a share only with a target", () => {
    expect(reviewOf({ accepted: 3, acceptedIsFloor: false, target: 5 })).toEqual({ line: "3 of 5 reviews", share: 0.6 });
    expect(reviewOf({ accepted: 2, acceptedIsFloor: false, target: null })).toEqual({ line: "2 reviews in", share: null });
    expect(reviewOf({ accepted: 30, acceptedIsFloor: true, target: 5 })).toEqual({ line: "30+ reviews in", share: null });
  });
  it("clamps the share to one", () => {
    expect(reviewOf({ accepted: 9, acceptedIsFloor: false, target: 5 }).share).toBe(1);
  });
});

describe("feedCards", () => {
  it("makes one card per project, with a favour only for a product on FAVOUR", () => {
    const cards = feedCards(page([row({ id: "draft_a" })], [launch("hn_1", 52)]), [vote("strive", 4)], { draft_a: detail() });
    expect(cards.map((c) => c.id)).toEqual(["draft_a", "strive", "hn_1"]);
    const [a, s, h] = cards;
    expect(a.favour).toEqual({ ask: "Try the onboarding and say where you got stuck", reward: "20 pts" });
    expect(a.review).toEqual({ line: "3 of 5 reviews", share: 0.6 });
    expect(a.contract).toEqual({ kind: "points" });
    expect(s.favour).toBeNull(); expect(s.review).toBeNull(); expect(s.contract).toBeNull(); expect(s.votes).toBe(4);
    expect(h.favour).toBeNull(); expect(h.review).toBeNull(); expect(h.contract).toBeNull();
    expect(h.source).toEqual({ kind: "launch", name: "Hacker News", score: 52 });
  });

  it("orders funded favours first, then points favours, then the rest in rail order", () => {
    const cards = feedCards(
      page([row({ id: "draft_pts" }), row({ id: "draft_usd" })], [launch("hn_1", 9)]),
      [vote("strive")],
      { draft_pts: detail(), draft_usd: detail({ task: fundedV2 }) },
    );
    expect(cards.map((c) => c.id)).toEqual(["draft_usd", "draft_pts", "strive", "hn_1"]);
    expect(cards[0].favour?.reward).toBe("$5 USDC");
    expect(cards[0].contract).toEqual({ kind: "escrow", usdc: 5, address: PINNED });
  });

  it("with no task to read, the campaign's own points are the reward, through reward.ts", () => {
    const cards = feedCards(page([row({ id: "draft_a", points: 7 })]), [], { draft_a: detail({ task: null }) });
    expect(cards[0].favour?.reward).toBe("7 pts");
    expect(cards[0].contract).toEqual({ kind: "points" });
  });

  it("says nothing about a favour when the server gave no detail, and clamps a long ask", () => {
    const none = feedCards(page([row({ id: "draft_a" })]), [], {});
    expect(none[0].favour).toBeNull(); expect(none[0].review).toBeNull(); expect(none[0].contract).toBeNull();
    const long = feedCards(page([row({ id: "draft_a" })]), [], { draft_a: detail({ ask: "word ".repeat(80) }) });
    expect(Array.from(long[0].favour!.ask).length).toBeLessThanOrEqual(ASK_MAX);
    expect(long[0].favour!.ask.endsWith("…")).toBe(true);
  });

  it("keeps a candidate whose count the server did not give as null, never zero", () => {
    const cards = feedCards(page([]), [vote("strive", null)], {});
    expect(cards[0].votes).toBeNull();
  });
});

describe("actionOf and the lines", () => {
  it("names the one action per kind, the review label from the reward", () => {
    const cards = feedCards(page([row({ id: "draft_a" })], [launch("hn_1", 1)]), [vote("strive")], { draft_a: detail() });
    expect(actionOf(cards[0])).toEqual({ kind: "review", label: "Review · 20 pts" });
    expect(actionOf(cards[1])).toEqual({ kind: "vote" });
    expect(actionOf(cards[2])).toEqual({ kind: "talk" });
  });
  it("gives no review action when the reward is unknown", () => {
    const cards = feedCards(page([row({ id: "draft_a" })]), [], {});
    expect(actionOf(cards[0])).toBeNull();
  });
  it("writes the contract line and the short address", () => {
    expect(contractLine({ kind: "escrow", usdc: 5, address: PINNED })).toBe("5.00 USDC in escrow");
    expect(contractLine({ kind: "points" })).toBe("Points only");
    expect(shortAddress(PINNED)).toBe("0x1111…1111");
  });
});
