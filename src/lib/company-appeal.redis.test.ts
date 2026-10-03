// Real Redis acceptance. Use an isolated Redis REST transport, never a live store:
// FAVOUR_LOCAL_REDIS_TEST=1 KV_REST_API_URL=http://127.0.0.1:16480 KV_REST_API_TOKEN=local-loop-only npx vitest run src/lib/company-appeal.redis.test.ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { getRedis } from "./redis";
import type { Task } from "./types";
import type { CampaignDraft } from "./campaign-draft-shape";
import { ensureCompanyAppeal, recordCompanyAppealVote, getCompanyAppeal, companyAppealHistory } from "./company-appeal";
import { getCompanyReview } from "./company-review";
import { checkCompletedTask, listContributions } from "./completions";
import { posterConfirm } from "./store";
import { getProofOfFavour } from "./proof-of-favour";

const enabled = process.env.FAVOUR_LOCAL_REDIS_TEST === "1";
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.KV_REST_API_URL || "")) throw new Error("Local Redis only");
const wallet = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}`;
async function setup() {
  const redis = getRedis()!;
  const owner = wallet(), participant = wallet(), judges = [wallet(), wallet(), wallet()];
  const id = `test_${randomUUID()}`, cid = `draft_${randomUUID()}`;
  const task = { id, companyCampaignId: cid, poster: owner, claimant: participant, status: "claimed", category: "photo", description: "Photograph the product label and explain the confusing ingredient.", location: "Anywhere", rewardType: "points", bountyUsdc: 7, onChainId: null, escrowTxHash: null, donOnChainId: null, donStakeTxHash: null, taskType: "standard", proofSubmissionId: randomUUID(), proofImageUrl: "https://example.test/proof.jpg", proofImages: ["https://example.test/proof.jpg"], proofNote: "The ingredient list is difficult to read under normal light.", verificationResult: { verdict: "flag", reasoning: "Photo needs review", confidence: 0 }, maxCompletions: 2, completionCount: 0 } as Task;
  const draft = { id: cid, company: "Local test company", owner, status: "published", reviewRule: "ai_and_jury", pieceTaskIds: { review: id } } as CampaignDraft;
  await redis.set(`task:${id}`, JSON.stringify(task)); await redis.set(`campaign:draft:${cid}`, JSON.stringify(draft));
  for (const j of judges) await redis.hset(`jury:stats:${j}`, { judged: 10, correct: 6 });
  const review = (await ensureCompanyAppeal(task))!;
  expect(review).not.toBeNull();
  return { redis, owner, participant, judges, task, draft, review };
}
const reason = "The submitted photograph and explanation meet this request.";
describe.skipIf(!enabled)("company review — actual Redis transaction", () => {
  it("three distinct qualified judges complete a piece once, retaining both histories and private company evidence", async () => {
    const f = await setup();
    expect(await posterConfirm(f.task.id, true)).toBeNull();
    expect(await f.redis.get(`task:${f.task.id}`)).toMatchObject({ status: "claimed", completionCount: 0 });
    expect(await recordCompanyAppealVote(f.owner, f.review.id, true, reason)).toHaveProperty("error");
    expect(await recordCompanyAppealVote(wallet(), f.review.id, true, reason)).toHaveProperty("error");
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, "passed")).toHaveProperty("error");
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, reason)).toMatchObject({ counted: true, outcome: "pending" });
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, reason)).toHaveProperty("error");
    expect(await recordCompanyAppealVote(f.judges[1], f.review.id, false, "The image is too dim to establish the label text.")).toMatchObject({ outcome: "pending" });
    expect((await getProofOfFavour(f.participant)).totalPoints).toBe(0);
    expect(await checkCompletedTask(f.task.id, f.participant)).toBe("no");
    const final = await recordCompanyAppealVote(f.judges[2], f.review.id, true, reason);
    expect(final).toMatchObject({ counted: true, outcome: "cleared", pointsAwardedToClaimant: 7 });
    expect(await recordCompanyAppealVote(f.judges[2], f.review.id, true, reason)).toHaveProperty("error");
    expect(await getProofOfFavour(f.participant)).toMatchObject({ totalPoints: 7, favoursCompleted: 1 });
    expect(await checkCompletedTask(f.task.id, f.participant)).toBe("yes");
    expect(await listContributions(f.participant)).toHaveLength(1);
    const task = await f.redis.get<Task>(`task:${f.task.id}`);
    expect(task).toMatchObject({ status: "open", completionCount: 1, claimant: null, proofNote: null });
    expect((await getCompanyAppeal(f.review.id))?.votes).toHaveLength(3);
    for (const account of [f.owner, f.participant]) {
      const history = await companyAppealHistory(account);
      expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ outcome: "cleared", points: 7 });
      expect(JSON.stringify(history)).not.toContain(f.judges[0]);
    }
    expect(await companyAppealHistory(wallet())).toEqual([]);
    const company = await getCompanyReview(f.owner, f.draft.id);
    expect(company?.evidence).toHaveLength(1);
    expect(company?.evidence[0]).toMatchObject({ note: f.task.proofNote, reviewMethod: "human_jury", reviewReasons: expect.any(Array) });
    expect(await getCompanyReview(f.participant, f.draft.id)).toBeNull();
  });
  it("declined quorum records reasons with zero points and reopens the piece", async () => {
    const f = await setup();
    for (const j of f.judges) await recordCompanyAppealVote(j, f.review.id, false, "The photo does not show the product requested in the brief.");
    expect((await getCompanyAppeal(f.review.id))?.outcome).toBe("upheld");
    expect((await getProofOfFavour(f.participant)).totalPoints).toBe(0);
    expect(await listContributions(f.participant)).toEqual([]);
    expect(await f.redis.sismember(`failed_claimants:${f.task.id}`, f.participant)).toBe(1);
    expect(await f.redis.get(`task:${f.task.id}`)).toMatchObject({ status: "open", completionCount: 0 });
    expect((await getCompanyReview(f.owner, f.draft.id))?.evidence[0].verdict).toBe("fail");
  });
  it("old cards cannot decide replaced proof; money and AI-only campaigns stay out", async () => {
    const f = await setup();
    await f.redis.set(`task:${f.task.id}`, JSON.stringify({ ...f.task, proofSubmissionId: randomUUID() }));
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, reason)).toHaveProperty("error");
    expect((await getCompanyAppeal(f.review.id))?.votes).toHaveLength(0);
    expect((await companyAppealHistory(f.participant))[0].outcome).toBe("superseded");
    await f.redis.set(`task:${f.task.id}`, JSON.stringify({ ...f.task, description: "A materially different request" }));
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, reason)).toHaveProperty("error");
    expect((await getCompanyAppeal(f.review.id))?.votes).toHaveLength(0);
    for (const patch of [{ rewardType: "usdc" }, { onChainId: 2 }, { escrowTxHash: "0x123" }, { campaignId: "cash" }, { donOnChainId: 3 }, { escrowV2Address: wallet() }]) expect(await ensureCompanyAppeal({ ...f.task, ...patch } as Task)).toBeNull();
    await f.redis.set(`campaign:draft:${f.draft.id}`, JSON.stringify({ ...f.draft, reviewRule: "ai" }));
    expect(await ensureCompanyAppeal(f.task)).toBeNull();
  });
  it("storage faults abort before votes or points; concurrent quorum retries award once", async () => {
    const f = await setup();
    await f.redis.set(`contributions:${f.participant}`, "wrong type");
    expect(await recordCompanyAppealVote(f.judges[0], f.review.id, true, reason)).toHaveProperty("error");
    expect((await getCompanyAppeal(f.review.id))?.votes).toHaveLength(0);
    expect((await getProofOfFavour(f.participant)).totalPoints).toBe(0);
    await f.redis.del(`contributions:${f.participant}`);
    for (const j of f.judges.slice(0,2)) await recordCompanyAppealVote(j, f.review.id, true, reason);
    const results = await Promise.all(Array.from({ length: 5 }, () => recordCompanyAppealVote(f.judges[2], f.review.id, true, reason)));
    expect(results.filter(r => "counted" in r)).toHaveLength(1);
    expect(await getProofOfFavour(f.participant)).toMatchObject({ totalPoints: 7, favoursCompleted: 1 });
    expect(await listContributions(f.participant)).toHaveLength(1);
  });
  it("preserves ordinary noncompany poster confirmation", async () => {
    const f = await setup(); const ordinary = { ...f.task, companyCampaignId: undefined };
    await f.redis.set(`task:${f.task.id}`, JSON.stringify(ordinary));
    expect(await posterConfirm(f.task.id, true)).toMatchObject({ status: "completed" });
  });
  it("does not replay legacy appeals that might already have awarded points", async () => {
    const f = await setup(); await f.redis.set(`appeal:resolved:${f.task.id}`, "cleared");
    expect(await ensureCompanyAppeal(f.task)).toBeNull();
  });
});
