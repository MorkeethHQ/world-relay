import { beforeEach, describe, expect, it, vi } from "vitest";
import { realRedis } from "./helpers/real-redis";
const db = vi.hoisted(() => ({ current: null as ReturnType<typeof realRedis> | null }));
vi.mock("@/lib/redis", () => ({ getRedis: () => db.current!.client }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
import { recordHouseReviewVote, houseProofToken, HOUSE_REVIEW_QUEUE } from "@/lib/house-review";
import { getTask } from "@/lib/store";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { WELCOME_ORIGINAL_STEPS } from "@/lib/welcome-shape";
import type { Task } from "@/lib/types";
const ANA = "0x7e57da7a000000000000000000000000000000a1";
const JUDGES = ["0x7e57da7a000000000000000000000000000000c1", "0x7e57da7a000000000000000000000000000000c2", "0x7e57da7a000000000000000000000000000000c3"];
const ID = "sol-real-instance";
const SOURCE = "sol-real-source";
beforeEach(async () => {
  db.current = realRedis();
  await db.current.command("FLUSHDB"); // This named no-network container contains TEST DATA only.
  const task = {
    id: ID, poster: "agent:relay", claimant: ANA, category: "feedback", campaignId: "first-favour",
    description: WELCOME_ORIGINAL_STEPS[4], location: "Anywhere", lat: null, lng: null, bountyUsdc: 10,
    deadline: "2027-01-01T00:00:00.000Z", status: "claimed", proofSubmissionId: "sol-test-proof",
    proofImageUrl: null, proofImages: null, proofNote: "TEST DATA: held a door for a neighbour.",
    verificationResult: { verdict: "flag", confidence: .5, reasoning: "TEST DATA uncertain check" },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null,
    escrowTxHash: null, claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 1, completionCount: 0, createdAt: "2026-10-05T00:00:00.000Z", welcomeFor: ANA, welcomeSourceId: SOURCE,
  } as Task;
  await db.current.client.set(`task:${ID}`, task);
  await db.current.client.sadd(HOUSE_REVIEW_QUEUE, ID);
  for (const judge of JUDGES) await db.current.client.hset(`jury:stats:${judge}`, { judged: 12, correct: 10 });
});
// The current proof token, as a dealt card would carry it (2026-10-05).
const vote = async (judge: string) => {
  const current = await getTask(ID);
  return recordHouseReviewVote(judge, ID, true, "TEST DATA: the written proof describes the requested kind act.", current ? houseProofToken(current) : "gone");
};
// Opt in after creating this disposable no-network container, as documented in
// scripts/REVIEW-FIXTURE.md. The ordinary suite must never contact a database.
describe.skipIf(process.env.FAVOUR_REAL_REDIS_TEST !== "1")("review resolution against real Redis with lost responses", () => {
  it("credits once and settles after three judges", async () => {
    await vote(JUDGES[0]); await vote(JUDGES[1]);
    expect(await vote(JUDGES[2])).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 10 });
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(10);
    expect((await getTask(ID))!.status).toBe("completed");
    await vote(JUDGES[2]);
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(10);
  });
  it("recovers when a successful completion-slot command loses its response", async () => {
    await vote(JUDGES[0]); await vote(JUDGES[1]);
    db.current!.loseResponseAfter((cmd, key, args) =>
      (cmd === "sadd" && key === `completed_claimants:${SOURCE}`) ||
      (cmd === "eval" && args.includes(`completed_claimants:${SOURCE}`)));
    expect(await vote(JUDGES[2])).toMatchObject({ code: "retry" });
    expect((await getTask(ID))!.status).toBe("claimed");
    expect(await vote(JUDGES[2])).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 10 });
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(10);
    expect((await getTask(ID))!.status).toBe("completed");
  });
  // Added with the fix (2026-10-05): the other two single-operation writes, on
  // the same real Redis, each losing its answer AFTER the script ran. A prior
  // profile shows whether a credit overwrote it or doubled.
  it.each([
    ["the keyed credit script", (cmd: string, _k: string, args: unknown[]) => cmd === "eval" && String(args[0]).startsWith("-- favour:keyed-credit")],
    ["the History row script", (cmd: string, _k: string, args: unknown[]) => cmd === "eval" && String(args[0]).startsWith("-- favour:case-history")],
  ])("recovers when %s loses its response, with one credit on top of the prior profile and one History row", async (_n, match) => {
    await db.current!.client.set(`pof:${ANA}`, { address: ANA, totalPoints: 40, level: "New Runner", favoursAttempted: 3, favoursCompleted: 3, favoursPosted: 0, currentStreak: 2, longestStreak: 2, lastActivityDate: "2026-10-04", pointsHistory: [{ action: "favour_completed", points: 40, timestamp: "2026-10-04T10:00:00.000Z" }] });
    await vote(JUDGES[0]); await vote(JUDGES[1]);
    db.current!.loseResponseAfter(match);
    const first = await vote(JUDGES[2]);
    expect(first).toMatchObject({ code: "retry" });
    expect((first as { error: string }).error).toMatch(/not confirmed/);
    expect((await getTask(ID))!.status).toBe("claimed");
    expect(await vote(JUDGES[2])).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 10 });
    const profile = await getProofOfFavour(ANA);
    expect(profile.totalPoints).toBe(50);
    expect(profile.favoursCompleted).toBe(4);
    expect(await db.current!.command("LLEN", `contributions:${ANA}`)).toBe(1);
    expect((await getTask(ID))!.status).toBe("completed");
    await vote(JUDGES[2]);
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(50);
    expect(await db.current!.command("LLEN", `contributions:${ANA}`)).toBe(1);
  });
  // The compare-and-set itself. A mutation that removed the hash comparison from
  // the script stayed green until this test existed.
  it("a profile that changed between the strict read and the write is not overwritten", async () => {
    const prior = { address: ANA, totalPoints: 40, level: "New Runner", favoursAttempted: 3, favoursCompleted: 3, favoursPosted: 0, currentStreak: 2, longestStreak: 2, lastActivityDate: "2026-10-04", pointsHistory: [] };
    await db.current!.client.set(`pof:${ANA}`, prior);
    await vote(JUDGES[0]); await vote(JUDGES[1]);
    // Another writer lands 99 points right after this request read the profile.
    const client = db.current!.client;
    const realEval = client.eval;
    let armed = true;
    client.eval = async (lua: string, keys: string[], args: unknown[]) => {
      const out = await realEval(lua, keys, args);
      if (armed && lua.includes("redis.sha1hex(v)") && keys[0] === `pof:${ANA}`) {
        armed = false;
        await db.current!.command("SET", `pof:${ANA}`, JSON.stringify({ ...prior, totalPoints: 99 }));
      }
      return out;
    };
    expect(await vote(JUDGES[2])).toMatchObject({ code: "retry" });
    // The other writer's 99 is intact: not replaced by 40 + 10.
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(99);
    client.eval = realEval;
    expect(await vote(JUDGES[2])).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 10 });
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(109);
  });
  it("someone else's pass already holds the step: cleared with no credit, as before", async () => {
    await db.current!.client.sadd(`completed_claimants:${SOURCE}`, ANA);
    await vote(JUDGES[0]); await vote(JUDGES[1]);
    expect(await vote(JUDGES[2])).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 0 });
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(0);
    expect(await db.current!.command("LLEN", `contributions:${ANA}`)).toBe(0);
  });
});
