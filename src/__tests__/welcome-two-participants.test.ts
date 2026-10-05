import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";

// TWO PEOPLE, ONE WELCOME FAVOUR (2026-10-05). TEST DATA throughout.
//
// The failure this pins was read off production on 5 Oct 2026 (public
// GET /api/tasks): all 8 Welcome favours were "claimed" with one earlier
// person's flagged photo on each, so nobody new could do any of them.
//
// These tests run the REAL routes (POST /api/welcome/start, POST
// /api/verify-proof, GET /api/welcome, the review route) and the real store,
// points, completion and session code, on an in-memory store. Only the model
// call and the outward side effects (chat, notifications, chain) are stand-ins.
const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
const verdict = vi.hoisted(() => ({ next: "pass" as "pass" | "flag" | "fail" | "throw" }));

vi.mock("@/lib/redis", () => ({ getRedis: () => mem.current!.client }));
vi.mock("@/lib/verify-proof", () => ({
  verifyProof: async () => {
    if (verdict.next === "throw") throw new Error("TEST DATA: the model service is down");
    return { verdict: verdict.next, reasoning: `TEST DATA stand-in: ${verdict.next}`, confidence: verdict.next === "flag" ? 0.5 : 0.95 };
  },
  verifyProofConsensus: async () => { throw new Error("consensus must not run on a points favour"); },
  verifyProofStub: () => { throw new Error("the random stub must not run in this test"); },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/verification-tier", () => ({ tierGateError: async () => null, getUserVerificationLevel: async () => "orb" }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: vi.fn(async () => null), resolveDon: vi.fn(async () => null) }));
vi.mock("@/lib/xmtp", () => ({ postProofSubmitted: async () => {}, postVerificationResult: async () => {}, postFollowUpQuestion: async () => {}, postSettlementConfirmation: async () => {}, syncAndProcessMessages: async () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateFollowUpQuestion: async () => null }));
vi.mock("@/lib/notifications", () => ({ notifyProofSubmitted: async () => {}, notifyVerified: async () => {}, notifyFlagged: async () => {}, notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async () => null }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/image-upload", () => ({ uploadProofImage: async (_b: string, id: string, i: number) => `https://blob.test/${id}/${i}.jpg` }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));
vi.mock("@/lib/referral", () => ({ recordReferralActivation: async () => {} }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));
const unlockSpy = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/campaign-unlock", async (orig) => {
  const real = await orig<typeof import("@/lib/campaign-unlock")>();
  return { ...real, recordCampaignCompletion: async (...a: Parameters<typeof real.recordCampaignCompletion>) => { const r = await real.recordCampaignCompletion(...a); unlockSpy.calls.push(r); return r; } };
});

import { POST as verifyProof } from "@/app/api/verify-proof/route";
import { POST as startWelcome } from "@/app/api/welcome/start/route";
import { GET as getWelcome } from "@/app/api/welcome/route";
import { GET as reviewDeck, POST as reviewVote } from "@/app/api/review/flagged/route";
import { GET as publicTasks } from "@/app/api/tasks/route";
import { GET as taskById } from "@/app/api/tasks/[id]/route";
import { POST as claimRoute } from "@/app/api/tasks/[id]/claim/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { houseProofToken } from "@/lib/house-review";
import { getTask, listTasks } from "@/lib/store";
import { listContributions } from "@/lib/completions";
import { welcomeInstanceId } from "@/lib/welcome-journey";
import { WELCOME_ORIGINAL_STEPS } from "@/lib/welcome-shape";
import type { Task } from "@/lib/types";
import type { NextRequest } from "next/server";

// TEST DATA wallets: synthetic identifiers. No real participant's sign-in is used.
const ANA = "0x7e57da7a000000000000000000000000000000a1";
const BEN = "0x7e57da7a000000000000000000000000000000b2";
const EARLIER = "0x7e57da7a000000000000000000000000000000e0";
const JUDGES = ["0x7e57da7a000000000000000000000000000000c1", "0x7e57da7a000000000000000000000000000000c2", "0x7e57da7a000000000000000000000000000000c3"];
const SOURCE_ID = "1dc3c50e-0000-4000-8000-00000000d001";
const DESCRIPTION = WELCOME_ORIGINAL_STEPS[0];

function req(url: string, wallet: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (wallet) headers.cookie = `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}`;
  return new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as NextRequest;
}

// The source row as production holds it: an original Welcome favour, 1000
// replies, held "claimed" by an earlier person's flagged photo.
function heldSource(over: Partial<Task> = {}): Task {
  return {
    id: SOURCE_ID, poster: "agent:relay", claimant: EARLIER, category: "photo", campaignId: "first-favour",
    description: DESCRIPTION, location: "Anywhere", lat: null, lng: null, bountyUsdc: 5,
    deadline: "2027-07-05T00:00:00.000Z", status: "claimed", proofSubmissionId: "earlier-proof",
    proofImageUrl: "https://blob.test/earlier.jpg", proofImages: ["https://blob.test/earlier.jpg"], proofNote: "TEST DATA earlier proof",
    verificationResult: { verdict: "flag", reasoning: "TEST DATA: city not stated", confidence: 0.7 },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null,
    escrowTxHash: null, claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 1000, completionCount: 1, createdAt: "2026-07-05T10:00:00.000Z", ...over,
  };
}
async function seed(t: Task) {
  await mem.current!.client.set(`task:${t.id}`, JSON.stringify(t));
  await mem.current!.client.sadd("task_ids", t.id);
}
const start = async (wallet: string, sourceTaskId = SOURCE_ID) => startWelcome(req("/api/welcome/start", wallet, { address: wallet, sourceTaskId }));
// Each proof carries its own photo bytes. The route's real duplicate-image guard
// flags a photo it has seen on another favour, and this file first met it by
// sending the same bytes for two people.
let photoSeq = 0;
const submit = async (wallet: string, taskId: string, note: string, withPhoto = true) =>
  verifyProof(req("/api/verify-proof", wallet, { taskId, submitter: wallet, proofNote: note, proofImages: withPhoto ? [Buffer.from(`TEST DATA photo ${++photoSeq} ${note}`).toString("base64")] : [] }));
const stepOf = async (wallet: string | null) => {
  const d = await (await getWelcome(req("/api/welcome", wallet))).json();
  return d.welcome.steps.find((s: { sourceTaskId: string }) => s.sourceTaskId === SOURCE_ID);
};
const points = async (w: string) => (await getProofOfFavour(w)).totalPoints;
// The token a dealt card would carry for the proof that is on the favour now.
const tokenOf = async (id: string) => { const t = await getTask(id); return t ? houseProofToken(t) : "no-such-favour"; };
async function qualify(judge: string) {
  await mem.current!.client.hset(`jury:stats:${judge.toLowerCase()}`, { judged: 12, correct: 10 });
}

beforeEach(async () => {
  mem.current = createMemoryRedis();
  verdict.next = "pass";
  unlockSpy.calls.length = 0;
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent-anywhere";
  delete process.env.OPENROUTER_API_KEY;
  await seed(heldSource());
});

// The proof route writes points without awaiting them (it always has). A test
// that ends on a pass must let that write land in ITS store, or it lands in the
// next test's. Each such test waits for the points; this is the backstop.
afterEach(async () => { await new Promise((r) => setTimeout(r, 120)); });

describe("Welcome is doable by a new person while the shared row is held", () => {
  it("the source row is held, and both new people still get the step", async () => {
    // The held row is not on anyone's board, exactly as on production.
    const board = await (await publicTasks()).json();
    expect(board.tasks.find((t: Task) => t.id === SOURCE_ID).status).toBe("claimed");

    // Signed out, and for each new person, the step reads "todo".
    expect((await stepOf(null)).state).toBe("todo");
    expect((await stepOf(ANA)).state).toBe("todo");
    expect((await stepOf(BEN)).state).toBe("todo");

    const a = await start(ANA);
    const b = await start(BEN);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aTask = (await a.json()).task as Task;
    const bTask = (await b.json()).task as Task;
    expect(aTask.id).not.toBe(bTask.id);
    expect(aTask.id).not.toBe(SOURCE_ID);
    // Source-bound and scoped: the original text, the source id, one owner.
    expect(aTask.description).toBe(DESCRIPTION);
    expect(aTask.welcomeSourceId).toBe(SOURCE_ID);
    expect(aTask.welcomeFor).toBe(ANA);
    expect(aTask.campaignId).toBe("first-favour");
    expect(aTask.maxCompletions).toBe(1);
    expect(aTask.rewardType).toBe("points");
    expect(aTask.onChainId).toBeNull();
    expect(aTask.escrowTxHash).toBeNull();
    // Asking again gives the same row, not a second one.
    expect(((await (await start(ANA)).json()).task as Task).id).toBe(aTask.id);
  });

  it("Ana's flagged proof does not take the step from Ben, and Ben's pass does not credit Ana", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    const flagged = await submit(ANA, aId, "TEST DATA Ana, tea, no city");
    expect(flagged.status).toBe(200);
    expect((await flagged.json()).verification.verdict).toBe("flag");
    expect((await stepOf(ANA)).state).toBe("in_review");

    // Ben is untouched by Ana's flag.
    expect((await stepOf(BEN)).state).toBe("todo");
    const bId = ((await (await start(BEN)).json()).task as Task).id;
    verdict.next = "pass";
    const passed = await submit(BEN, bId, "TEST DATA Ben, coffee, Lagos");
    expect(passed.status).toBe(200);
    const body = await passed.json();
    expect(body.verification.verdict).toBe("pass");
    expect(body.pointsAwarded).toBeGreaterThanOrEqual(5);

    expect((await stepOf(BEN)).state).toBe("done");
    expect((await stepOf(ANA)).state).toBe("in_review");
    // The route writes the points without awaiting them, so wait for the write.
    await vi.waitFor(async () => expect(await points(BEN)).toBeGreaterThanOrEqual(5));
    expect(await points(ANA)).toBe(0);
    // Ben's History row is bound to the Welcome campaign.
    const rows = await listContributions(BEN);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe("first-favour");
    // Ben's slot is on the SOURCE step.
    expect(await mem.current!.client.sismember(`completed_claimants:${SOURCE_ID}`, BEN)).toBe(1);
    expect(await mem.current!.client.sismember(`completed_claimants:${SOURCE_ID}`, ANA)).toBe(0);
  });

  it("the earlier claim on the source row is not reopened, edited or deleted", async () => {
    const before = mem.current!.raw(`task:${SOURCE_ID}`);
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana");
    const bId = ((await (await start(BEN)).json()).task as Task).id;
    verdict.next = "pass";
    await submit(BEN, bId, "TEST DATA Ben");
    await vi.waitFor(async () => expect(await points(BEN)).toBeGreaterThanOrEqual(5));
    // Byte for byte the row it was.
    expect(mem.current!.raw(`task:${SOURCE_ID}`)).toBe(before);
    // The earlier person, asking to start, is sent to their own claim on the row.
    const again = await (await start(EARLIER)).json();
    expect(again.shared).toBe(true);
    expect(again.task.id).toBe(SOURCE_ID);
  });

  it("a step is credited once per person", async () => {
    const bId = ((await (await start(BEN)).json()).task as Task).id;
    await submit(BEN, bId, "TEST DATA Ben");
    await vi.waitFor(async () => expect(await points(BEN)).toBeGreaterThanOrEqual(5));
    const after = await points(BEN);
    expect((await start(BEN)).status).toBe(409);
    const repeat = await submit(BEN, bId, "TEST DATA Ben again");
    expect(repeat.status).toBeGreaterThanOrEqual(400);
    await new Promise((r) => setTimeout(r, 30));
    expect(await points(BEN)).toBe(after);
  });

  it("nobody else can submit to, claim or read a person's instance", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    expect(aId).toBe(welcomeInstanceId(SOURCE_ID, ANA));
    const stolen = await submit(BEN, aId, "TEST DATA Ben on Ana's row");
    expect(stolen.status).toBe(403);
    expect((await getTask(aId))!.claimant).toBeNull();
    const claim = await claimRoute(req(`/api/tasks/${aId}/claim`, BEN, { claimant: BEN }), { params: Promise.resolve({ id: aId }) });
    expect(claim.status).toBe(404);
    // Not in any shared list, and the public detail route answers 404.
    expect((await listTasks()).some((t) => t.id === aId)).toBe(false);
    expect(((await (await publicTasks()).json()).tasks as Task[]).some((t) => t.id === aId)).toBe(false);
    const detail = await taskById(req(`/api/tasks/${aId}`, null), { params: Promise.resolve({ id: aId }) });
    expect(detail.status).toBe(404);
    // The same holds AFTER a proof is on it. (The first version of this test
    // stopped before a proof was sent, and a mutation that put instances back in
    // the shared list stayed green, because only a saved proof goes through the
    // store's list write.)
    verdict.next = "flag";
    expect((await submit(ANA, aId, "TEST DATA Ana private note")).status).toBe(200);
    expect((await listTasks()).some((t) => t.id === aId)).toBe(false);
    expect(await mem.current!.client.sismember("task_ids", aId)).toBe(0);
    expect(JSON.stringify(await (await publicTasks()).json())).not.toContain("Ana private note");
    expect((await taskById(req(`/api/tasks/${aId}`, null), { params: Promise.resolve({ id: aId }) })).status).toBe(404);
    // Ben, signed in, sees none of it in his own Welcome view.
    expect(JSON.stringify(await (await getWelcome(req("/api/welcome", BEN))).json())).not.toContain("Ana private note");
    // No session, or another wallet's session, starts nothing for Ana.
    expect((await startWelcome(req("/api/welcome/start", null, { address: ANA, sourceTaskId: SOURCE_ID }))).status).toBe(403);
    expect((await startWelcome(req("/api/welcome/start", BEN, { address: ANA, sourceTaskId: SOURCE_ID }))).status).toBe(403);
  });

  it("an OPEN shared Welcome row takes no direct proof and no claim, so it cannot be held again", async () => {
    await seed(heldSource({ status: "open", claimant: null, proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null, proofSubmissionId: undefined }));
    verdict.next = "flag";
    const direct = await submit(ANA, SOURCE_ID, "TEST DATA Ana on the shared row");
    expect(direct.status).toBe(409);
    expect((await direct.json()).code).toBe("welcome_instance_required");
    const claim = await claimRoute(req(`/api/tasks/${SOURCE_ID}/claim`, ANA, { claimant: ANA }), { params: Promise.resolve({ id: SOURCE_ID }) });
    expect(claim.status).toBe(409);
    expect((await getTask(SOURCE_ID))!.status).toBe("open");
  });

  it("only original Welcome material can be a source", async () => {
    const junk = "junk0000-0000-4000-8000-000000000001";
    await seed(heldSource({ id: junk, poster: ANA, description: "TEST DATA a row a person posted into the campaign", status: "open", claimant: null, verificationResult: null }));
    expect((await start(BEN, junk)).status).toBe(404);
    const funded = "fund0000-0000-4000-8000-000000000002";
    await seed(heldSource({ id: funded, onChainId: 7, escrowTxHash: `0x${"a".repeat(64)}` }));
    expect((await start(BEN, funded)).status).toBe(404);
    const expired = "expd0000-0000-4000-8000-000000000003";
    await seed(heldSource({ id: expired, status: "expired", description: WELCOME_ORIGINAL_STEPS[8] }));
    expect((await start(BEN, expired)).status).toBe(404);
  });
});

describe("a service failure is not a score", () => {
  it("when the check throws, nothing is scored, nobody is flagged and the step stays doable", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "throw";
    const res = await submit(ANA, aId, "TEST DATA Ana while the service is down");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("check_unavailable");
    const row = (await getTask(aId))!;
    expect(row.verificationResult).toBeNull();
    expect(row.status).toBe("open");
    expect((await stepOf(ANA)).state).toBe("todo");
    expect(await points(ANA)).toBe(0);
    expect(await mem.current!.client.scard("house:review:queue")).toBe(0);
    // The same proof, sent again once the service is back, is accepted.
    verdict.next = "pass";
    expect((await submit(ANA, aId, "TEST DATA Ana, second try")).status).toBe(200);
    expect((await stepOf(ANA)).state).toBe("done");
    await vi.waitFor(async () => expect(await points(ANA)).toBeGreaterThanOrEqual(5));
  });

  it("a FUNDED favour keeps the old rule: an outage flags it and never reopens it", async () => {
    const funded = "fund0000-0000-4000-8000-000000000009";
    await seed(heldSource({ id: funded, campaignId: undefined, rewardType: "usdc", maxCompletions: 1, completionCount: 0, status: "open", claimant: null, verificationResult: null, onChainId: 9, escrowTxHash: `0x${"b".repeat(64)}`, description: "TEST DATA funded favour" }));
    verdict.next = "throw";
    const res = await submit(ANA, funded, "TEST DATA Ana");
    expect(res.status).toBe(200);
    const row = (await getTask(funded))!;
    expect(row.status).toBe("claimed");
    expect(row.verificationResult?.verdict).toBe("flag");
  });
});

describe("human review of a flagged Welcome proof", () => {
  async function flagAna(withPhoto: boolean) {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana, a written answer", withPhoto);
    return aId;
  }
  const vote = async (judge: string, caseId: string, v: "real" | "not", reason = "TEST DATA: the answer names the drink and the city asked for.") =>
    reviewVote(req("/api/review/flagged", judge, { address: judge, caseId, proofToken: await tokenOf(caseId), verdict: v, reason }));

  it("a flagged TEXT proof reaches the reviewers, and two of three clearing it credits points once", async () => {
    const aId = await flagAna(false);
    for (const j of JUDGES) await qualify(j);
    const deck = await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json();
    expect(deck.yourCallCounts).toBe(true);
    // Two cases wait: Ana's own instance, and the earlier person's claim that is
    // still on the shared row.
    expect(deck.cards.map((c: { scope: string }) => c.scope).sort()).toEqual(["welcome_instance", "welcome_source"]);
    const card = deck.cards.find((c: { caseId: string }) => c.caseId === aId);
    expect(card.proofNote).toContain("written answer");
    // No sender's wallet is on any card.
    expect(JSON.stringify(deck.cards).toLowerCase()).not.toContain(ANA.toLowerCase());
    expect(JSON.stringify(deck.cards).toLowerCase()).not.toContain(EARLIER.toLowerCase());

    expect((await (await vote(JUDGES[0], aId, "real")).json()).outcome).toBe("pending");
    expect(await points(ANA)).toBe(0);
    expect((await (await vote(JUDGES[1], aId, "not")).json()).outcome).toBe("pending");
    const last = await (await vote(JUDGES[2], aId, "real")).json();
    expect(last.outcome).toBe("cleared");
    expect(last.pointsAwardedToClaimant).toBe(5);
    expect(await points(ANA)).toBe(5);
    expect((await stepOf(ANA)).state).toBe("done");
    const row = (await getTask(aId))!;
    expect(row.status).toBe("completed");
    // The AI's flag is kept as a flag; the human decision sits beside it.
    expect(row.verificationResult?.verdict).toBe("flag");
    expect(row.humanReview?.outcome).toBe("cleared");
    // A fourth vote changes nothing.
    await qualify(BEN);
    expect((await vote(BEN, aId, "real")).status).toBe(409);
    expect(await points(ANA)).toBe(5);
    // No campaign cash progress was written by any of this.
    expect(unlockSpy.calls.every((c) => (c as { counted: boolean }).counted === false)).toBe(true);
    expect([...mem.current!.kv.keys(), ...mem.current!.sets.keys()].some((k) => k.startsWith("unlock:"))).toBe(false);
  });

  it("a cleared review credits nothing if the person already holds the step", async () => {
    const aId = await flagAna(true);
    // Ana already has this step on record, as someone who passed the shared row
    // before instances existed would.
    await mem.current!.client.sadd(`completed_claimants:${SOURCE_ID}`, ANA);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId, "real");
    await vote(JUDGES[1], aId, "real");
    const last = await (await vote(JUDGES[2], aId, "real")).json();
    expect(last.outcome).toBe("cleared");
    expect(last.pointsAwardedToClaimant).toBe(0);
    expect(await points(ANA)).toBe(0);
    expect(await listContributions(ANA)).toHaveLength(0);
  });

  it("declined by the reviewers: no points, and the person's own step opens again", async () => {
    const aId = await flagAna(true);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId, "not", "TEST DATA: the photo shows no drink at all, only a wall.");
    await vote(JUDGES[1], aId, "not", "TEST DATA: nothing in the photo matches what was asked.");
    const last = await (await vote(JUDGES[2], aId, "real")).json();
    expect(last.outcome).toBe("upheld");
    expect(await points(ANA)).toBe(0);
    const step = await stepOf(ANA);
    expect(step.state).toBe("todo");
    expect(step.reviewNote.reasons).toHaveLength(2);
    // Ben was never affected.
    expect((await stepOf(BEN)).state).toBe("todo");
  });

  it("refuses the owner, an unqualified judge, a missing session and a short reason", async () => {
    const aId = await flagAna(true);
    await qualify(ANA);
    expect((await vote(ANA, aId, "real")).status).toBe(409);
    expect((await vote(BEN, aId, "real")).status).toBe(409); // Ben has no graded record
    await qualify(BEN);
    expect((await reviewVote(req("/api/review/flagged", null, { address: BEN, caseId: aId, proofToken: await tokenOf(aId), verdict: "real", reason: "TEST DATA: long enough reason here." }))).status).toBe(403);
    expect((await reviewVote(req("/api/review/flagged", JUDGES[0], { address: BEN, caseId: aId, proofToken: await tokenOf(aId), verdict: "real", reason: "TEST DATA: long enough reason here." }))).status).toBe(403);
    expect((await vote(BEN, aId, "real", "too short")).status).toBe(409);
    expect((await vote(BEN, aId, "real")).status).toBe(200);
    expect((await vote(BEN, aId, "real")).status).toBe(409); // once per judge
    expect(await points(ANA)).toBe(0);
  });

  it("a new proof starts a new case: old votes do not carry over", async () => {
    const aId = await flagAna(true);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId, "real");
    await vote(JUDGES[1], aId, "real");
    verdict.next = "flag";
    expect((await submit(ANA, aId, "TEST DATA Ana, a different proof")).status).toBe(200);
    const next = await (await vote(JUDGES[2], aId, "real")).json();
    expect(next.outcome).toBe("pending");
    expect(next.tally).toEqual({ real: 1, not: 0 });
    expect(await points(ANA)).toBe(0);
  });
});

describe("only a qualified reviewer is shown a flagged proof", () => {
  it("an unqualified signed-in person gets a count and their record, and no proof data", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana private written answer", false);
    const res = await reviewDeck(req("/api/review/flagged", BEN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.yourCallCounts).toBe(false);
    expect(body.cards).toEqual([]);
    expect(body.waiting).toBe(2);
    expect(body.yourRecord).toEqual({ judged: 0, correct: 0 });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("private written answer");
    expect(raw).not.toContain("earlier proof");
    expect(raw).not.toContain(DESCRIPTION);
    expect(raw).not.toContain("blob.test");
    // A judge under the accuracy bar is not qualified either.
    await mem.current!.client.hset(`jury:stats:${BEN.toLowerCase()}`, { judged: 30, correct: 10 });
    expect((await (await reviewDeck(req("/api/review/flagged", BEN))).json()).cards).toEqual([]);
    // Signed out: refused.
    expect((await reviewDeck(req("/api/review/flagged", null))).status).toBe(403);
    // Once qualified, the same person is shown the cases.
    await qualify(BEN);
    expect((await (await reviewDeck(req("/api/review/flagged", BEN))).json()).cards).toHaveLength(2);
  });
});

describe("a storage failure at the last vote is retryable, never a silent uncredited clear", () => {
  const vote = async (judge: string, caseId: string, v: "real" | "not") =>
    reviewVote(req("/api/review/flagged", judge, { address: judge, caseId, proofToken: await tokenOf(caseId), verdict: v, reason: "TEST DATA: the answer does what the favour asked for." }));

  it("slot unknown: nothing resolved, case stays queued, and the last judge finishes it on retry with one credit", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana written answer", false);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId, "real");
    await vote(JUDGES[1], aId, "real");

    // THE FAILURE: the slot operation cannot run when the last vote lands.
    const client = mem.current!.client;
    const realEval = client.eval;
    client.eval = (async (script: string, keys: string[], args: unknown[]) => {
      if (keys[0]?.startsWith("completed_claimants:")) throw new Error("TEST DATA: the store is down");
      return realEval(script, keys, args);
    }) as typeof client.eval;
    const failed = await vote(JUDGES[2], aId, "real");
    expect(failed.status).toBe(503);
    expect((await failed.json()).code).toBe("retry");
    // Nothing was manufactured: no points, not completed, not resolved, still queued.
    expect(await points(ANA)).toBe(0);
    const during = (await getTask(aId))!;
    expect(during.status).toBe("claimed");
    expect(during.humanReview).toBeUndefined();
    expect(await client.sismember("house:review:queue", aId)).toBe(1);
    expect([...mem.current!.kv.keys()].some((k) => k.startsWith("house:review:resolved:"))).toBe(false);
    expect((await stepOf(ANA)).state).toBe("in_review");
    expect(await listContributions(ANA)).toHaveLength(0);

    // THE RETRY, by the same last judge, whose vote is already counted.
    client.eval = realEval;
    const retried = await vote(JUDGES[2], aId, "real");
    expect(retried.status).toBe(200);
    const done = await retried.json();
    expect(done.outcome).toBe("cleared");
    expect(done.counted).toBe(false); // no second vote was taken
    expect(done.tally).toEqual({ real: 3, not: 0 });
    expect(done.pointsAwardedToClaimant).toBe(5);
    expect(await points(ANA)).toBe(5);
    expect((await getTask(aId))!.status).toBe("completed");
    expect(await client.sismember("house:review:queue", aId)).toBe(0);
    expect(await listContributions(ANA)).toHaveLength(1);
    // A further call credits nothing more.
    expect((await vote(JUDGES[2], aId, "real")).status).toBe(409);
    expect(await points(ANA)).toBe(5);
  });

  it("the credit write fails after the slot was taken: still retryable, and the retry credits exactly once", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana written answer", false);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId, "real");
    await vote(JUDGES[1], aId, "real");
    const client = mem.current!.client;
    const realEval = client.eval;
    client.eval = (async (script: string, keys: string[], args: unknown[]) => {
      if (script.startsWith("-- favour:keyed-credit")) throw new Error("TEST DATA: the profile write failed");
      return realEval(script, keys, args);
    }) as typeof client.eval;
    const failed = await vote(JUDGES[2], aId, "real");
    expect(failed.status).toBe(503);
    expect((await getTask(aId))!.status).toBe("claimed");
    expect(await points(ANA)).toBe(0);
    client.eval = realEval;
    const done = await (await vote(JUDGES[2], aId, "real")).json();
    expect(done.outcome).toBe("cleared");
    expect(await points(ANA)).toBe(5);
    expect(await listContributions(ANA)).toHaveLength(1);
  });

  it("once three votes are in, a fourth judge cannot flip the decision", async () => {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana written answer", false);
    for (const j of [...JUDGES, BEN]) await qualify(j);
    const client = mem.current!.client;
    const realSadd = client.sadd;
    await vote(JUDGES[0], aId, "not");
    await vote(JUDGES[1], aId, "not");
    // The declining decision cannot be saved on the first try.
    const realSet = client.set;
    client.set = (async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (k.startsWith("house:review:resolved:")) throw new Error("TEST DATA: the store is down");
      return realSet(k, v, o);
    }) as typeof client.set;
    await vote(JUDGES[2], aId, "real").catch(() => null);
    client.set = realSet;
    client.sadd = realSadd;
    // A fourth judge says "real". It is not counted: the tally stays 1 to 2.
    const fourth = await vote(BEN, aId, "real");
    const body = await fourth.json();
    expect(await points(ANA)).toBe(0);
    if (fourth.status === 200) {
      expect(body.counted).toBe(false);
      expect(body.outcome).toBe("upheld");
      expect(body.tally).toEqual({ real: 1, not: 2 });
    } else {
      expect(fourth.status).toBe(409);
    }
  });
});

describe("the earlier person's original claim on the shared row can be decided", () => {
  const vote = async (judge: string, v: "real" | "not") =>
    reviewVote(req("/api/review/flagged", judge, { address: judge, caseId: SOURCE_ID, proofToken: await tokenOf(SOURCE_ID), verdict: v, reason: "TEST DATA: judged against the original Welcome text." }));

  it("their Welcome view says in review, on the shared row, and that is now true", async () => {
    const step = await stepOf(EARLIER);
    expect(step.state).toBe("in_review");
    expect(step.onSharedRow).toBe(true);
    await qualify(JUDGES[0]);
    const deck = await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json();
    expect(deck.cards.map((c: { caseId: string; scope: string }) => [c.caseId, c.scope])).toEqual([[SOURCE_ID, "welcome_source"]]);
    expect(deck.cards[0].description).toBe(DESCRIPTION);
  });

  it("accepted: points once to the earlier person, and newcomers are untouched before, during and after", async () => {
    for (const j of JUDGES) await qualify(j);
    // A newcomer starts and passes while the old claim is still undecided.
    const bId = ((await (await start(BEN)).json()).task as Task).id;
    await submit(BEN, bId, "TEST DATA Ben, coffee, Lagos");
    await vi.waitFor(async () => expect(await points(BEN)).toBeGreaterThanOrEqual(5));
    const benBefore = await points(BEN);

    const before = mem.current!.raw(`task:${SOURCE_ID}`);
    await vote(JUDGES[0], "real");
    await vote(JUDGES[1], "not");
    // Until the third reviewer decides, the source claim is byte for byte as it was.
    expect(mem.current!.raw(`task:${SOURCE_ID}`)).toBe(before);
    const last = await (await vote(JUDGES[2], "real")).json();
    expect(last.outcome).toBe("cleared");
    expect(last.pointsAwardedToClaimant).toBe(5);
    expect(await points(EARLIER)).toBe(5);
    expect(await points(BEN)).toBe(benBefore);
    expect(await points(ANA)).toBe(0);
    // The earlier person has the step, once, on the source's own completer set.
    expect(await mem.current!.client.sismember(`completed_claimants:${SOURCE_ID}`, EARLIER)).toBe(1);
    expect((await stepOf(EARLIER)).state).toBe("done");
    expect(await listContributions(EARLIER)).toHaveLength(1);
    // The row was settled by the store's own late-pass transition: reply counted,
    // free for the next person. It is still a Welcome source and still not a
    // board card, and a newcomer still does the step on their own instance.
    const row = (await getTask(SOURCE_ID))!;
    expect(row.completionCount).toBe(2);
    expect(row.status).toBe("open");
    expect((await submit(ANA, SOURCE_ID, "TEST DATA Ana on the shared row")).status).toBe(409);
    expect((await stepOf(ANA)).state).toBe("todo");
    expect((await start(ANA)).status).toBe(200);
    // The earlier person cannot be credited for the step again by any route.
    expect((await start(EARLIER)).status).toBe(409);
    expect(await points(EARLIER)).toBe(5);
  });

  it("declined: no points, the claim is released, and the earlier person continues on their own instance", async () => {
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], "not");
    await vote(JUDGES[1], "not");
    expect((await (await vote(JUDGES[2], "not")).json()).outcome).toBe("upheld");
    expect(await points(EARLIER)).toBe(0);
    expect((await getTask(SOURCE_ID))!.completionCount).toBe(1);
    expect((await stepOf(EARLIER)).state).toBe("todo");
    const again = await (await start(EARLIER)).json();
    expect(again.shared).toBe(false);
    expect(again.task.welcomeFor).toBe(EARLIER);
  });

  it("the earlier person may send a new proof on their held claim, and that starts a new case", async () => {
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], "not");
    verdict.next = "flag";
    expect((await submit(EARLIER, SOURCE_ID, "TEST DATA earlier person, a new proof")).status).toBe(200);
    const next = await (await vote(JUDGES[0], "real")).json();
    expect(next.outcome).toBe("pending");
    expect(next.tally).toEqual({ real: 1, not: 0 });
  });

  it("the earlier person cannot review their own held proof", async () => {
    await qualify(EARLIER);
    expect((await vote(EARLIER, "real")).status).toBe(409);
    expect((await (await reviewDeck(req("/api/review/flagged", EARLIER))).json()).cards).toEqual([]);
  });
});

describe("a response lost AFTER the write landed is recognised on retry", () => {
  const vote = async (judge: string, caseId: string) =>
    reviewVote(req("/api/review/flagged", judge, { address: judge, caseId, proofToken: await tokenOf(caseId), verdict: "real", reason: "TEST DATA: the answer does what the favour asked for." }));
  // The operation runs for real, then its answer is thrown away, once.
  function loseAnswerOnce(match: (script: string, keys: string[]) => boolean) {
    const client = mem.current!.client;
    const realEval = client.eval;
    let armed = true;
    client.eval = (async (script: string, keys: string[], args: unknown[]) => {
      const out = await realEval(script, keys, args);
      if (armed && match(script, keys)) { armed = false; throw new Error("TEST DATA: response lost after the store applied the command"); }
      return out;
    }) as typeof client.eval;
    return () => { client.eval = realEval; };
  }
  async function twoVotesIn() {
    const aId = ((await (await start(ANA)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(ANA, aId, "TEST DATA Ana written answer", false);
    for (const j of JUDGES) await qualify(j);
    await vote(JUDGES[0], aId);
    await vote(JUDGES[1], aId);
    return aId;
  }
  // A person who already has points and a history, so an overwrite would show.
  async function givePriorProfile() {
    await mem.current!.client.set(`pof:${ANA}`, JSON.stringify({ address: ANA, totalPoints: 40, level: "New Runner", favoursAttempted: 3, favoursCompleted: 3, favoursPosted: 0, currentStreak: 2, longestStreak: 2, lastActivityDate: "2026-10-04", pointsHistory: [{ action: "favour_completed", points: 40, timestamp: "2026-10-04T10:00:00.000Z" }] }));
  }

  it.each([
    ["the slot and its marker", (s: string) => s.startsWith("-- favour:case-slot")],
    ["the keyed credit", (s: string) => s.startsWith("-- favour:keyed-credit")],
    ["the History row and its marker", (s: string) => s.startsWith("-- favour:case-history")],
  ])("%s: first call says not confirmed, retry clears with the points, and exactly one credit and one row exist", async (_n, match) => {
    await givePriorProfile();
    const aId = await twoVotesIn();
    const restore = loseAnswerOnce(match);
    const first = await vote(JUDGES[2], aId);
    expect(first.status).toBe(503);
    const said = await first.json();
    expect(said.code).toBe("retry");
    // The line is true whether or not a write landed.
    expect(said.error).toMatch(/not confirmed/);
    expect(said.error).not.toMatch(/Nothing was credited/);
    expect((await getTask(aId))!.status).toBe("claimed");
    restore();
    const done = await (await vote(JUDGES[2], aId)).json();
    expect(done).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 5, counted: false });
    const profile = await getProofOfFavour(ANA);
    expect(profile.totalPoints).toBe(45);
    expect(profile.favoursCompleted).toBe(4);
    expect(profile.pointsHistory).toHaveLength(2);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getTask(aId))!.status).toBe("completed");
    expect(await mem.current!.client.sismember(`completed_claimants:${SOURCE_ID}`, ANA)).toBe(1);
    // And a third call adds nothing.
    await vote(JUDGES[2], aId);
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(45);
    expect(await listContributions(ANA)).toHaveLength(1);
  });

  it("the profile cannot be READ at the award: nothing is written over it, and the retry adds to it", async () => {
    await givePriorProfile();
    const before = mem.current!.raw(`pof:${ANA}`);
    const aId = await twoVotesIn();
    const client = mem.current!.client;
    const realEval = client.eval;
    // The strict read fails. The display reader would have answered a zero profile.
    client.eval = (async (script: string, keys: string[], args: unknown[]) => {
      if (script.includes("redis.sha1hex(v)") && keys[0] === `pof:${ANA}`) throw new Error("TEST DATA: the profile read failed");
      return realEval(script, keys, args);
    }) as typeof client.eval;
    expect((await vote(JUDGES[2], aId)).status).toBe(503);
    expect(mem.current!.raw(`pof:${ANA}`)).toBe(before);
    client.eval = realEval;
    expect((await (await vote(JUDGES[2], aId)).json()).outcome).toBe("cleared");
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(45);
  });

  it("the favour's own row cannot be saved: not confirmed, and the retry finishes without a second credit", async () => {
    const aId = await twoVotesIn();
    const client = mem.current!.client;
    const realSet = client.set;
    let armed = true;
    client.set = (async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (armed && k === `task:${aId}`) { armed = false; throw new Error("TEST DATA: the row write failed"); }
      return realSet(k, v, o);
    }) as typeof client.set;
    expect((await vote(JUDGES[2], aId)).status).toBe(503);
    expect(await points(ANA)).toBe(5); // the credit had landed, and the line did not deny it
    client.set = realSet;
    expect((await (await vote(JUDGES[2], aId)).json()).outcome).toBe("cleared");
    expect(await points(ANA)).toBe(5);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getTask(aId))!.status).toBe("completed");
  });

  it("the credit goes to the wallet exactly as the favour holds it, mixed case included", async () => {
    const MIXED = "0x7E57Da7A000000000000000000000000000000Aa";
    const sId = ((await (await start(MIXED)).json()).task as Task).id;
    verdict.next = "flag";
    await submit(MIXED, sId, "TEST DATA mixed case written answer", false);
    for (const j of JUDGES) { await qualify(j); await vote(j, sId); }
    expect((await getProofOfFavour(MIXED)).totalPoints).toBe(5);
    expect((await getProofOfFavour(MIXED.toLowerCase())).totalPoints).toBe(0);
  });
});
