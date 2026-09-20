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
  pickDailyMission,
  pickProofStrip,
  dailyMissionScore,
  PROOF_STRIP_MAX,
  isMissionCandidate,
  boardTier,
  rankBoard,
  curateBoard,
  orderBoardForApi,
  pickStarterFavour,
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

describe("pickStarterFavour", () => {
  it("prefers online feedback points tasks over photo errands", () => {
    const photo = task({ category: "photo", location: "London", rewardType: "points", bountyUsdc: 15 });
    const feedback = task({ category: "feedback", location: "Online", description: "Rate this app honestly", rewardType: "points", bountyUsdc: 1 });
    expect(pickStarterFavour([photo, feedback], "user1", NOW)?.id).toBe(feedback.id);
  });

  it("skips the user's own posts", () => {
    const mine = task({ poster: "user1", category: "feedback", location: "Online", rewardType: "points" });
    expect(pickStarterFavour([mine], "user1", NOW)).toBeNull();
  });
});


// R13, THE DAILY MISSION. The front screen leads with ONE favour, chosen by the
// rule in board-rank.ts rather than by whatever happened to rank first.
//
// The measurement this exists for, taken from the live board on 2026-09-20: the
// deployed selector put "What's the last thing that made you laugh out loud today?"
// in front of a stranger, while the favour that states the whole promise of a
// verified-human board, "what does today smell like where you are?", sat below the
// fold. Easiest and most distinctive are different questions.
describe("pickDailyMission", () => {
  const SMELL = "An AI can read everything ever written and still cannot answer this: what does today smell like where you are?";
  const LAUGH = "What's the last thing that made you laugh out loud today, even just a little?";

  it("puts the sensory favour in front of the easy one", () => {
    const laugh = task({ poster: "agent:hermes", description: LAUGH, location: "Anywhere", rewardType: "points", bountyUsdc: 10 });
    const smell = task({ poster: "agent:openclaw", description: SMELL, location: "Anywhere", rewardType: "points", bountyUsdc: 9 });
    expect(pickDailyMission([laugh, smell], "2026-09-20", "user1", NOW)?.id).toBe(smell.id);
    expect(dailyMissionScore(smell)).toBeGreaterThan(dailyMissionScore(laugh));
  });

  it("is the same favour for everyone on a given day, and stable across the day", () => {
    const a = task({ description: SMELL, poster: "agent:a", rewardType: "points", bountyUsdc: 9 });
    const b = task({ description: "How does your street sound right now?", poster: "agent:b", rewardType: "points", bountyUsdc: 9 });
    const board = [a, b];
    const one = pickDailyMission(board, "2026-09-20", "alice", NOW);
    const two = pickDailyMission(board, "2026-09-20", "bob", NOW + 6 * HOUR);
    expect(one?.id).toBe(two?.id);
  });

  it("rotates inside the top-scoring group as the date moves", () => {
    // Both score identically, so only the date decides. Over enough days both
    // must appear, or "rotating" is a word with nothing behind it.
    const a = task({ id: "aaa", description: SMELL, poster: "agent:a", rewardType: "points", bountyUsdc: 9 } as Partial<Task>);
    const b = task({ id: "bbb", description: SMELL, poster: "agent:b", rewardType: "points", bountyUsdc: 9 } as Partial<Task>);
    const seen = new Set<string>();
    for (const d of ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]) {
      seen.add(pickDailyMission([a, b], d, null, NOW)!.id);
    }
    expect(seen.size).toBe(2);
  });

  it("works for a signed-out caller, because that is who the launch screen is for", () => {
    // Regression: the first version filtered on `t.claimant !== userId`, and an
    // OPEN favour has a null claimant, so with userId null every candidate was
    // excluded and the front screen fell back to the plain board. Found by running
    // the selector against the real board rather than against a fixture.
    const smell = task({ description: SMELL, poster: "agent:openclaw", rewardType: "points", bountyUsdc: 9 });
    expect(pickDailyMission([smell], "2026-09-20", null, NOW)?.id).toBe(smell.id);
  });

  it("never offers a favour the caller posted or already claimed", () => {
    const mine = task({ poster: "user1", description: SMELL, rewardType: "points", bountyUsdc: 9 });
    const claimed = task({ claimant: "user1", status: "claimed", description: SMELL, rewardType: "points", bountyUsdc: 9 });
    expect(pickDailyMission([mine, claimed], "2026-09-20", "user1", NOW)).toBeNull();
  });

  it("returns null rather than promoting a favour with no signature quality", () => {
    // An empty first screen is honest. Dressing an errand up as the daily mission
    // is not, and the repair is to author better supply.
    const dull = task({ description: "Deliver this parcel to the address given", category: "delivery", location: "London", rewardType: "points", bountyUsdc: 5 });
    expect(pickDailyMission([dull], "2026-09-20", null, NOW)).toBeNull();
    expect(isMissionCandidate(dull)).toBe(false);
  });

  it("never offers a money favour as the mission (points only, invariant 1)", () => {
    const funded = task({ description: SMELL, rewardType: "usdc", bountyUsdc: 20, onChainId: 4, escrowTxHash: `0x${"a".repeat(64)}` });
    expect(pickDailyMission([funded], "2026-09-20", null, NOW)).toBeNull();
  });
});

describe("pickProofStrip", () => {
  it("shows only REAL completed proofs, never preview or test identities", () => {
    const real = task({ status: "completed", proofImageUrl: "/api/tasks/x/proof-image?i=0", poster: "agent:openclaw", claimant: "0x1" });
    const devPoster = task({ status: "completed", proofImageUrl: "/p.jpg", poster: "dev_abc" });
    const devClaimant = task({ status: "completed", proofImageUrl: "/p.jpg", poster: "agent:x", claimant: "demo_1" });
    const noImage = task({ status: "completed", proofImageUrl: null, poster: "agent:y" });
    const stillOpen = task({ status: "open", proofImageUrl: "/p.jpg", poster: "agent:z" });
    const strip = pickProofStrip([real, devPoster, devClaimant, noImage, stillOpen]);
    expect(strip.map((t) => t.id)).toEqual([real.id]);
  });

  it("an ordinary remote agent errand does not clear the bar on those traits alone", () => {
    // remote + agent-posted + a fair points value sums to 30, and that is every
    // filler favour the replenisher used to post. Without the sensory or here-and-now
    // rule this selector would promote exactly the supply the board is moving away
    // from.
    const errand = task({ poster: "agent:fresh", description: "Recommend one place visitors always miss", location: "Anywhere", rewardType: "points", bountyUsdc: 10 });
    expect(isMissionCandidate(errand)).toBe(false);
    expect(pickDailyMission([errand], "2026-09-20", null, NOW)).toBeNull();
  });
});

describe("pickProofStrip more", () => {
  it("caps the strip", () => {
    const many = Array.from({ length: PROOF_STRIP_MAX + 5 }, () =>
      task({ status: "completed", proofImageUrl: "/p.jpg", poster: "agent:openclaw" }),
    );
    expect(pickProofStrip(many)).toHaveLength(PROOF_STRIP_MAX);
  });

  it("renders nothing when no real proof exists, rather than decorating", () => {
    expect(pickProofStrip([task({ status: "completed", proofImageUrl: null })])).toEqual([]);
  });
});
