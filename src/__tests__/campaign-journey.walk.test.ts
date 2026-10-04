import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";
import { createTask, getTask, listTasks, claimTask, submitProof, completeTask, setFollowUp, resolveFollowUp } from "@/lib/store";
import { isBoardVisible, rankBoard, curateBoard, boardTier, TIER } from "@/lib/board-rank";
import { getFeaturedCampaign } from "@/lib/campaigns";
import { checkCompletedTask } from "@/lib/completions";

// THE WELCOME CAMPAIGN JOURNEY, WALKED AGAINST A LOCAL DOUBLE (2026-10-04).
// The store below is an in-memory stand-in for Redis. Nothing here touches the
// live app. The walk follows what production showed on 4 Oct: a 1000 reply
// welcome favour, one person's proof flagged, a follow-up question pending.
// Each step prints what a second visitor would see, so the output reads as a walk.
const kv = new Map<string, string>();
const sets = new Map<string, Set<string>>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, v); return "OK"; },
    get: async (k: string) => kv.get(k) || null,
    del: async (k: string) => { kv.delete(k); },
    sadd: async (k: string, m: string) => { if (!sets.has(k)) sets.set(k, new Set()); const had = sets.get(k)!.has(m); sets.get(k)!.add(m); return had ? 0 : 1; },
    smembers: async (k: string) => Array.from(sets.get(k) || []),
    sismember: async (k: string, m: string) => (sets.get(k)?.has(m) ? 1 : 0),
    pipeline: () => { const ops: Array<() => unknown> = []; return { get: (k: string) => { ops.push(() => kv.get(k) || null); }, exec: async () => ops.map((op) => op()) }; },
  }),
}));

beforeEach(() => { kv.clear(); sets.clear(); });

const ANA = "0xAna0000000000000000000000000000000000001";
const BEN = "0xBen0000000000000000000000000000000000002";
const say = (step: string, t: Task | undefined, viewer: string) =>
  console.log(`[walk, local double] ${step}: status=${t?.status} replies=${t?.completionCount}/${t?.maxCompletions} claimant=${t?.claimant ? t.claimant.slice(0, 6) : "none"} on the board for ${viewer.slice(0, 5)}=${t ? isBoardVisible(t, viewer, Date.now()) : false}`);

describe("welcome campaign journey, local double", () => {
  it("a flagged proof no longer ends a 1000 reply welcome favour once it is cleared", async () => {
    const now = Date.now();
    const created = await createTask({
      poster: "agent:relay", description: "Photo your first drink of the day and tell us your city", location: "Anywhere",
      bountyUsdc: 5, deadlineHours: 24 * 30, rewardType: "points", maxCompletions: 1000, campaignId: "first-favour", category: "photo",
    } as Parameters<typeof createTask>[0]);
    const id = created.id;

    // 1. Seeded. Ben, a new visitor, sees it, and it ranks as the featured journey.
    let t = await getTask(id);
    say("1 seeded", t, BEN);
    expect(isBoardVisible(t!, BEN, now)).toBe(true);
    expect(getFeaturedCampaign(now)?.id).toBe("first-favour");
    expect(boardTier(t!, BEN, getFeaturedCampaign(now)!.id, now)).toBe(TIER.FEATURED);

    // 2. Ana claims and submits a photo. The check flags it and asks a follow-up.
    await claimTask(id, ANA);
    await submitProof(id, "https://blob.example/ana.jpg", "coffee", null, ANA);
    await completeTask(id, { verdict: "flag", reasoning: "city not stated", confidence: 0.7 });
    await setFollowUp(id, "Which city are you in?", 0.7);
    t = await getTask(id);
    say("2 Ana flagged, follow-up pending", t, BEN);
    // STILL BROKEN, and recorded as such: while the flag stands, the favour is
    // off the board for everyone but Ana. This is the hold that had 44 favours
    // on 4 Oct. This branch does not change it.
    expect(t!.status).toBe("claimed");
    expect(isBoardVisible(t!, BEN, now)).toBe(false);
    expect(isBoardVisible(t!, ANA, now)).toBe(true);

    // 3. Ana answers the follow-up and the check passes it.
    await resolveFollowUp(id, { verdict: "pass", reasoning: "city given", confidence: 0.9 });
    t = await getTask(id);
    say("3 Ana's follow-up passed", t, BEN);
    // Before this branch: status completed, the favour gone for good.
    expect(t!.status).toBe("open");
    expect(t!.completionCount).toBe(1);
    expect(isBoardVisible(t!, BEN, now)).toBe(true);

    // 4. Ana cannot pass it a second time. Ben can do it.
    expect(await checkCompletedTask(id, ANA)).toBe("yes");
    expect(await checkCompletedTask(id, BEN)).toBe("no");
    await claimTask(id, BEN);
    await submitProof(id, "https://blob.example/ben.jpg", "tea, Lagos", null, BEN);
    await completeTask(id, { verdict: "pass", reasoning: "ok", confidence: 0.95 });
    t = await getTask(id);
    say("4 Ben passed first time", t, ANA);
    expect(t!.status).toBe("open");
    expect(t!.completionCount).toBe(2);

    // 5. The board a third visitor gets: the welcome favour leads, and it is not stale.
    const board = curateBoard(rankBoard((await listTasks()).filter((x) => isBoardVisible(x, null, now)), { userId: null, userLocation: null, now }), null, now);
    console.log(`[walk, local double] 5 signed-out board: ${board.map((x) => `${x.campaignId ?? "plain"}:${x.completionCount}`).join(", ")}`);
    expect(board[0].id).toBe(id);
  });
});
