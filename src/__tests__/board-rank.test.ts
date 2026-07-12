import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Task } from "@/lib/types";
import {
  BOARD_CAP,
  DUPLICATE_DESC_CAP,
  FEEDBACK_WINDOW,
  FEEDBACK_MAX_IN_WINDOW,
  POLL_INSERT_AFTER,
  POLL_CARDS_MAX,
  TIER,
  isBoardVisible,
  boardTier,
  rankBoard,
  curateBoard,
  orderBoardForApi,
} from "@/lib/board-rank";
import { getFeaturedCampaign } from "@/lib/campaigns";

const NOW = new Date("2026-07-05T12:00:00Z").getTime();
const HOUR = 3600_000;

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `t${seq}`,
    poster: `poster${seq}`,
    claimant: null,
    category: "photo",
    description: `unique task description number ${seq}`,
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 5,
    deadline: new Date(NOW + 100 * HOUR).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1,
    completionCount: 0,
    createdAt: new Date(NOW - 1 * HOUR).toISOString(),
    ...overrides,
  } as Task;
}

const funded = (o: Partial<Task> = {}) =>
  task({ rewardType: "usdc", onChainId: 1, escrowTxHash: `0x${"a".repeat(64)}`, ...o });

describe("R3: board visibility", () => {
  it("an unfunded USDC feedback task is NOT visible (the old bypass is closed)", () => {
    const t = task({ rewardType: "usdc", category: "feedback", onChainId: null, escrowTxHash: null });
    expect(isBoardVisible(t, null, NOW)).toBe(false);
  });

  it("points tasks and funded USDC tasks are visible", () => {
    expect(isBoardVisible(task(), null, NOW)).toBe(true);
    expect(isBoardVisible(funded(), null, NOW)).toBe(true);
  });

  it("a 0-value points task is NOT visible (reads as broken/empty inventory)", () => {
    expect(isBoardVisible(task({ rewardType: "points", bountyUsdc: 0 }), null, NOW)).toBe(false);
  });

  it("claimed tasks show only to their claimant; expired/cancelled/past-deadline never show", () => {
    const mine = task({ status: "claimed", claimant: "me" });
    expect(isBoardVisible(mine, "me", NOW)).toBe(true);
    expect(isBoardVisible(mine, "other", NOW)).toBe(false);
    expect(isBoardVisible(task({ status: "cancelled" }), "me", NOW)).toBe(false);
    expect(isBoardVisible(task({ status: "expired" }), "me", NOW)).toBe(false);
    expect(isBoardVisible(task({ deadline: new Date(NOW - HOUR).toISOString() }), "me", NOW)).toBe(false);
  });
});

describe("R5: tier order", () => {
  const featuredId = getFeaturedCampaign()!.id;

  it("my claim > funded > featured campaign > points > feedback > stale", () => {
    const myClaim = task({ status: "claimed", claimant: "me" });
    const money = funded();
    const featured = task({ campaignId: featuredId });
    const points = task();
    const feedback = task({ category: "feedback" });
    const stale = task({ createdAt: new Date(NOW - 8 * 24 * HOUR).toISOString() });

    const ranked = rankBoard([stale, feedback, points, featured, money, myClaim], {
      userId: "me",
      userLocation: null,
      now: NOW,
    });
    expect(ranked.map((t) => t.id)).toEqual([myClaim, money, featured, points, feedback, stale].map((t) => t.id));
  });

  it("evergreen multi-completion tasks never go stale (the welcome journey must not self-bury)", () => {
    const old = new Date(NOW - 30 * 24 * HOUR).toISOString();
    const evergreen = task({ createdAt: old, maxCompletions: 1000 } as Partial<Task>);
    const oneShot = task({ createdAt: old });
    expect(boardTier(evergreen, null, null, NOW)).not.toBe(TIER.STALE);
    expect(boardTier(oneShot, null, null, NOW)).toBe(TIER.STALE);
  });

  it("a featured-campaign feedback task ranks as FEATURED, not FEEDBACK", () => {
    const t = task({ campaignId: featuredId, category: "feedback" });
    expect(boardTier(t, null, featuredId, NOW)).toBe(TIER.FEATURED);
  });

  it("within a tier, feedback tasks sort after actionable tasks even when newer", () => {
    const olderPhoto = task({ campaignId: featuredId, createdAt: new Date(NOW - 5 * HOUR).toISOString() });
    const newerFeedback = task({ campaignId: featuredId, category: "feedback", createdAt: new Date(NOW - 1 * HOUR).toISOString() });
    const ranked = rankBoard([newerFeedback, olderPhoto], { userId: null, userLocation: null, now: NOW });
    expect(ranked[0].id).toBe(olderPhoto.id);
  });

  it("points amounts are never 'urgent': a 25-pt task does not outrank fresher points tasks", () => {
    const bigPoints = task({ bountyUsdc: 25, createdAt: new Date(NOW - 5 * HOUR).toISOString() });
    const fresh = task({ bountyUsdc: 5, createdAt: new Date(NOW - 1 * HOUR).toISOString() });
    const ranked = rankBoard([bigPoints, fresh], { userId: null, userLocation: null, now: NOW });
    expect(ranked[0].id).toBe(fresh.id);
  });
});

describe("R1: feedback share cap", () => {
  it(`allows at most ${FEEDBACK_MAX_IN_WINDOW} feedback tasks in the first ${FEEDBACK_WINDOW} cards`, () => {
    const feedback = Array.from({ length: 6 }, () => task({ category: "feedback" }));
    const photos = Array.from({ length: 14 }, () => task());
    // Rank order puts photos (POINTS tier) before feedback anyway; force the
    // adversarial case by curating a feedback-first list directly.
    const curated = curateBoard([...feedback, ...photos], null);
    const window = curated.slice(0, FEEDBACK_WINDOW);
    expect(window.filter((t) => t.category === "feedback").length).toBeLessThanOrEqual(FEEDBACK_MAX_IN_WINDOW);
    // Nothing is dropped, only demoted.
    expect(curated.length).toBe(20);
  });

  it("a board that is ONLY feedback still shows tasks (cap demotes, never empties)", () => {
    const feedback = Array.from({ length: 5 }, () => task({ category: "feedback" }));
    const curated = curateBoard(feedback, null);
    expect(curated.length).toBe(5);
  });
});

describe("curation: duplicates, board cap, own items", () => {
  it(`collapses identical descriptions past ${DUPLICATE_DESC_CAP}`, () => {
    const dupes = Array.from({ length: 4 }, () => task({ description: "Same template text" }));
    expect(curateBoard(dupes, null).length).toBe(DUPLICATE_DESC_CAP);
  });

  it(`caps the board at ${BOARD_CAP} but never hides the user's own overflow`, () => {
    const many = Array.from({ length: 35 }, () => task());
    const mine = task({ poster: "me" });
    const curated = curateBoard([...many, mine], "me");
    expect(curated.length).toBe(BOARD_CAP + 1);
    expect(curated.some((t) => t.id === mine.id)).toBe(true);
  });
});

describe("server-side ordering (GET /api/tasks)", () => {
  it("orders open tasks by board rank with feedback demoted, non-open after, drops NOTHING", () => {
    const funded1 = funded();
    const feedback = Array.from({ length: 5 }, () => task({ category: "feedback" }));
    const photos = Array.from({ length: 12 }, () => task());
    const completed = task({ status: "completed" });
    const claimed = task({ status: "claimed", claimant: "someone" });
    const input = [...feedback, completed, ...photos, claimed, funded1];

    const ordered = orderBoardForApi(input, NOW);

    expect(ordered.length).toBe(input.length);
    expect(ordered[0].id).toBe(funded1.id);
    const openCount = 18;
    const openSlice = ordered.slice(0, openCount);
    expect(openSlice.every((t) => t.status === "open")).toBe(true);
    expect(
      openSlice.slice(0, FEEDBACK_WINDOW).filter((t) => t.category === "feedback").length
    ).toBeLessThanOrEqual(FEEDBACK_MAX_IN_WINDOW);
    expect(ordered.slice(openCount).map((t) => t.status).sort()).toEqual(["claimed", "completed"]);
  });

  it("the tasks API route calls orderBoardForApi", () => {
    const routeSrc = readFileSync(join(__dirname, "../app/api/tasks/route.ts"), "utf8");
    expect(routeSrc).toMatch(/orderBoardForApi/);
  });
});

describe("R2: poll placement is wired into the Feed", () => {
  const feedSrc = readFileSync(join(__dirname, "../components/Feed.tsx"), "utf8");

  it("polls render gated on POLL_INSERT_AFTER and capped at POLL_CARDS_MAX", () => {
    expect(POLL_INSERT_AFTER).toBe(3);
    expect(POLL_CARDS_MAX).toBe(2);
    expect(feedSrc).toMatch(/i === POLL_INSERT_AFTER/);
    expect(feedSrc).toMatch(/limit=\{POLL_CARDS_MAX\}/);
    // No unguarded FeedPolls above the list: every render passes the limit prop.
    const renders = feedSrc.match(/<FeedPolls[^/]*\/>/g) || [];
    expect(renders.length).toBeGreaterThan(0);
    for (const r of renders) expect(r).toContain("limit={POLL_CARDS_MAX}");
  });

  it("the old feedback-category visibility bypass never comes back", () => {
    expect(feedSrc).not.toMatch(/category\s*!==\s*["']feedback["']/);
  });
});
