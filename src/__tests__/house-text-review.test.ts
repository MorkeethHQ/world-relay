import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";

// A WRITTEN ANSWER ON A PLAIN HOUSE FAVOUR, DECIDED BY REVIEWERS (2026-10-05).
// TEST DATA. Real routes: the proof route flags the answer, the review route
// deals it to qualified judges, and their decision credits points once and
// settles the favour. On 5 Oct 2026 the public board held 28 such answers with
// nobody able to decide them.
const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
const verdict = vi.hoisted(() => ({ next: "flag" as "pass" | "flag" | "fail" | "throw" }));
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

import { POST as verifyProof } from "@/app/api/verify-proof/route";
import { GET as reviewDeck, POST as reviewVote } from "@/app/api/review/flagged/route";
import { GET as photoDeck } from "@/app/api/jury/appeal/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { houseProofToken } from "@/lib/house-review";
import { getTask } from "@/lib/store";
import { listContributions } from "@/lib/completions";
import type { Task } from "@/lib/types";
import type { NextRequest } from "next/server";

const ANA = "0x7e57da7a000000000000000000000000000000a1";
const BEN = "0x7e57da7a000000000000000000000000000000b2";
const JUDGES = ["0x7e57da7a000000000000000000000000000000c1", "0x7e57da7a000000000000000000000000000000c2", "0x7e57da7a000000000000000000000000000000c3"];
const ID = "house000-0000-4000-8000-000000000001";

function req(url: string, wallet: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (wallet) headers.cookie = `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}`;
  return new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as NextRequest;
}
function favour(over: Partial<Task> = {}): Task {
  return {
    id: ID, poster: "agent:relay", claimant: null, category: "feedback", description: "TEST DATA favour: what does the air smell like where you are?",
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 6, deadline: "2027-01-01T00:00:00.000Z", status: "open",
    proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null, attestationTxHash: null, agent: null,
    aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard",
    rewardType: "points", donOnChainId: null, donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 100, completionCount: 3, createdAt: "2026-10-01T00:00:00.000Z", ...over,
  };
}
async function seed(t: Task) {
  await mem.current!.client.set(`task:${t.id}`, JSON.stringify(t));
  await mem.current!.client.sadd("task_ids", t.id);
}
const answer = (wallet: string, note: string, id = ID) => verifyProof(req("/api/verify-proof", wallet, { taskId: id, submitter: wallet, proofNote: note, proofImages: [] }));
const vote = async (judge: string, v: "real" | "not", id = ID) =>
  reviewVote(req("/api/review/flagged", judge, { address: judge, caseId: id, proofToken: await tokenOf(id), verdict: v, reason: "TEST DATA: the answer is on topic and specific." }));
const points = async (w: string) => (await getProofOfFavour(w)).totalPoints;
// The token a dealt card would carry for the proof that is on the favour now.
const tokenOf = async (id: string) => { const t = await getTask(id); return t ? houseProofToken(t) : "no-such-favour"; };

beforeEach(async () => {
  mem.current = createMemoryRedis();
  verdict.next = "flag";
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent-anywhere";
  delete process.env.OPENROUTER_API_KEY;
  await seed(favour());
  for (const j of JUDGES) await mem.current.client.hset(`jury:stats:${j}`, { judged: 12, correct: 10 });
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 120)); });

describe("a flagged written answer on a house favour", () => {
  it("goes to the house review and not to the photo appeal", async () => {
    expect((await answer(ANA, "TEST DATA: wet pavement and bread")).status).toBe(200);
    const deck = await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]).toMatchObject({ caseId: ID, scope: "house_text", proofNote: "TEST DATA: wet pavement and bread", images: [], points: 6 });
    expect(JSON.stringify(deck).toLowerCase()).not.toContain(ANA.toLowerCase());
    expect((await (await photoDeck(req("/api/jury/appeal", JUDGES[0]))).json()).cards).toEqual([]);
  });

  it("accepted by two of three: points once, a History row, the reply counted and the favour open for the next person", async () => {
    await answer(ANA, "TEST DATA: wet pavement and bread");
    expect((await getTask(ID))!.status).toBe("claimed");
    expect((await (await vote(JUDGES[0], "real")).json()).outcome).toBe("pending");
    expect((await (await vote(JUDGES[1], "not")).json()).outcome).toBe("pending");
    expect(await points(ANA)).toBe(0);
    const last = await (await vote(JUDGES[2], "real")).json();
    expect(last).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 6, tally: { real: 2, not: 1 } });
    expect(await points(ANA)).toBe(6);
    const row = (await getTask(ID))!;
    expect(row.status).toBe("open");
    expect(row.claimant).toBeNull();
    expect(row.completionCount).toBe(4);
    expect(await mem.current!.client.sismember(`completed_claimants:${ID}`, ANA)).toBe(1);
    const history = await listContributions(ANA);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ taskId: ID, points: 6 });
    // Once decided, it cannot be decided or credited again, and Ana cannot redo it.
    expect((await vote(JUDGES[0], "real")).status).toBe(409);
    expect((await answer(ANA, "TEST DATA: again")).status).toBe(409);
    expect(await points(ANA)).toBe(6);
    // Ben can now answer the same favour.
    verdict.next = "pass";
    expect((await answer(BEN, "TEST DATA: cut grass")).status).toBe(200);
  });

  it("declined: no points, and the favour is released instead of staying held", async () => {
    await answer(ANA, "TEST DATA: asdf");
    await vote(JUDGES[0], "not");
    await vote(JUDGES[1], "not");
    expect((await (await vote(JUDGES[2], "real")).json()).outcome).toBe("upheld");
    expect(await points(ANA)).toBe(0);
    const row = (await getTask(ID))!;
    expect(row.status).toBe("open");
    expect(row.completionCount).toBe(3);
    expect(await listContributions(ANA)).toHaveLength(0);
  });

  it("the same rules as every review: session, own wallet, qualified, reasoned, once per judge, never your own proof", async () => {
    await answer(ANA, "TEST DATA: wet pavement");
    const body = { address: JUDGES[0], caseId: ID, proofToken: await tokenOf(ID), verdict: "real", reason: "TEST DATA: a long enough reason." };
    expect((await reviewVote(req("/api/review/flagged", null, body))).status).toBe(403);
    expect((await reviewVote(req("/api/review/flagged", JUDGES[1], body))).status).toBe(403);
    expect((await reviewVote(req("/api/review/flagged", JUDGES[0], { ...body, reason: "short" }))).status).toBe(409);
    expect((await vote(BEN, "real")).status).toBe(409); // not qualified
    await mem.current!.client.hset(`jury:stats:${ANA.toLowerCase()}`, { judged: 12, correct: 10 });
    expect((await vote(ANA, "real")).status).toBe(409); // own proof
    expect((await vote(JUDGES[0], "real")).status).toBe(200);
    expect((await vote(JUDGES[0], "real")).status).toBe(409); // once
    expect(await points(ANA)).toBe(0);
  });

  it("a new answer is a new case", async () => {
    await answer(ANA, "TEST DATA: first answer");
    await vote(JUDGES[0], "real");
    await vote(JUDGES[1], "real");
    expect((await answer(ANA, "TEST DATA: second answer")).status).toBe(200);
    const next = await (await vote(JUDGES[2], "real")).json();
    expect(next).toMatchObject({ outcome: "pending", tally: { real: 1, not: 0 } });
    expect(await points(ANA)).toBe(0);
  });

  it("a held answer from before this review existed (no proof id) is reachable too", async () => {
    await seed(favour({ status: "claimed", claimant: ANA, proofNote: "TEST DATA: a legacy held answer", verificationResult: { verdict: "flag", reasoning: "AI verification error - proof flagged for manual review.", confidence: 0 } }));
    const deck = await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json();
    expect(deck.cards.map((c: { caseId: string }) => c.caseId)).toEqual([ID]);
    await vote(JUDGES[0], "real");
    await vote(JUDGES[1], "real");
    expect((await (await vote(JUDGES[2], "real")).json()).outcome).toBe("cleared");
    expect(await points(ANA)).toBe(6);
  });
});

describe("the service is down: no score, and nothing for a reviewer to decide", () => {
  it("a written answer is not flagged, not held and not queued when the check throws", async () => {
    verdict.next = "throw";
    const res = await answer(ANA, "TEST DATA: wet pavement");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("check_unavailable");
    const row = (await getTask(ID))!;
    expect(row.status).toBe("open");
    expect(row.claimant).toBeNull();
    expect(row.verificationResult).toBeNull();
    expect((await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json()).cards).toEqual([]);
    expect(await points(ANA)).toBe(0);
    // Ben is not blocked by Ana's unscored attempt.
    verdict.next = "pass";
    expect((await answer(BEN, "TEST DATA: cut grass")).status).toBe(200);
  });
});

describe("what the house review never reaches", () => {
  const flaggedRow = (over: Partial<Task>) => favour({ status: "claimed", claimant: ANA, proofSubmissionId: "p", proofNote: "TEST DATA answer", verificationResult: { verdict: "flag", reasoning: "r", confidence: 0.5 }, ...over });
  it.each([
    ["a funded favour", { rewardType: "usdc" as const, onChainId: 3, escrowTxHash: `0x${"a".repeat(64)}`, maxCompletions: 1 }],
    ["a points favour with a placeholder escrow hash", { escrowTxHash: "funded" }],
    ["an escrow-v2 favour", { rewardType: "usdc-v2" as const, escrowV2Address: `0x${"e".repeat(40)}` }],
    ["a Double or Nothing favour", { taskType: "double-or-nothing" as const, donOnChainId: 2 }],
    ["a favour in a cash unlock campaign", { campaignId: "say-it-out-loud" }],
    ["a favour a person posted", { poster: BEN }],
    ["a company piece", { companyCampaignId: "draft_1" }],
    // A preview identity can hold no points: clearing it would ask for a retry
    // for ever. The store holds such rows; the public board hides them.
    ["a proof sent by a dev_ identity", { claimant: "dev_1a2b3c4d" }],
    ["a proof sent by an e2e_ identity", { claimant: "e2e_runner" }],
  ])("%s is not dealt and a vote on it is refused", async (_n, over) => {
    await seed(flaggedRow(over as Partial<Task>));
    expect((await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json()).cards).toEqual([]);
    const res = await vote(JUDGES[0], "real");
    expect(res.status).toBe(409);
    expect(await points(ANA)).toBe(0);
    expect((await getTask(ID))!.status).toBe("claimed");
    // And it is not counted as waiting for anyone.
    expect((await (await reviewDeck(req("/api/review/flagged", JUDGES[0]))).json()).waiting).toBe(0);
  });
  it("a client cannot relabel a row: the scope comes from the stored favour, whatever the request says", async () => {
    await seed(flaggedRow({ poster: BEN }));
    const res = await reviewVote(req("/api/review/flagged", JUDGES[0], { address: JUDGES[0], caseId: ID, proofToken: await tokenOf(ID), verdict: "real", scope: "house_text", poster: "agent:relay", reason: "TEST DATA: a long enough reason." }));
    expect(res.status).toBe(409);
  });
});

describe("a decision is about the proof the reviewer was shown", () => {
  const post = (judge: string, proofToken: unknown, v: "real" | "not" = "real") =>
    reviewVote(req("/api/review/flagged", judge, { address: judge, caseId: ID, ...(proofToken === undefined ? {} : { proofToken }), verdict: v, reason: "TEST DATA: judged on what this card showed." }));
  const dealt = async (judge: string) => (await (await reviewDeck(req("/api/review/flagged", judge))).json()).cards as Array<{ caseId: string; proofToken: string; proofNote: string }>;
  const snapshot = () => JSON.stringify({
    row: mem.current!.raw(`task:${ID}`),
    kv: [...mem.current!.kv.keys()].filter((k) => k.startsWith("house:review:")).sort(),
    sets: [...mem.current!.sets.entries()].filter(([k]) => k.startsWith("house:review:") || k.startsWith("completed_claimants:")).map(([k, v]) => [k, [...v].sort()]),
    hashes: [...mem.current!.hashes.entries()].filter(([k]) => k.startsWith("house:review:")).map(([k, v]) => [k, [...v.entries()]]),
    lists: [...mem.current!.lists.keys()].filter((k) => k.startsWith("house:review:") || k.startsWith("contributions:")),
  });

  it("a card dealt for proof A cannot vote on proof B, and the fresh card for B works", async () => {
    await answer(ANA, "TEST DATA proof A: wet pavement");
    const cardA = (await dealt(JUDGES[0]))[0];
    expect(cardA.proofNote).toContain("proof A");
    expect(cardA.proofToken).toMatch(/^[0-9a-f]{24}$/);
    // No wallet and no proof text can be read out of the token or the card.
    expect(JSON.stringify(cardA).toLowerCase()).not.toContain(ANA.toLowerCase());
    expect(cardA.proofToken).not.toContain("wet");

    // The sender replaces the proof while the reviewer still has card A open.
    expect((await answer(ANA, "TEST DATA proof B: something else entirely")).status).toBe(200);
    const before = snapshot();
    const stale = await post(JUDGES[0], cardA.proofToken, "real");
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("stale");
    // Nothing moved: no vote, no tally, no marker, no slot, no row change.
    expect(snapshot()).toBe(before);
    expect(await points(ANA)).toBe(0);

    // The same reviewer loads the current card and decides proof B.
    const cardB = (await dealt(JUDGES[0]))[0];
    expect(cardB.proofNote).toContain("proof B");
    expect(cardB.proofToken).not.toBe(cardA.proofToken);
    expect(await (await post(JUDGES[0], cardB.proofToken)).json()).toMatchObject({ counted: true, outcome: "pending", tally: { real: 1, not: 0 } });
    await post(JUDGES[1], cardB.proofToken);
    expect(await (await post(JUDGES[2], cardB.proofToken)).json()).toMatchObject({ outcome: "cleared", pointsAwardedToClaimant: 6 });
    expect(await points(ANA)).toBe(6);
  });

  it("a stale card cannot finish a decision either: with two votes in on A, a vote carrying A's token after B arrives resolves nothing", async () => {
    await answer(ANA, "TEST DATA proof A");
    const tokenA = (await dealt(JUDGES[0]))[0].proofToken;
    await post(JUDGES[0], tokenA);
    await post(JUDGES[1], tokenA);
    await answer(ANA, "TEST DATA proof B");
    const before = snapshot();
    expect((await post(JUDGES[2], tokenA)).status).toBe(409);
    expect(snapshot()).toBe(before);
    expect(await points(ANA)).toBe(0);
    expect((await getTask(ID))!.status).toBe("claimed");
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["a made-up token", "0".repeat(24)],
    ["the favour's id instead of a token", ID],
    ["a token that is not a string", 12345],
  ])("%s is refused and nothing is counted", async (_n, token) => {
    await answer(ANA, "TEST DATA proof A");
    const before = snapshot();
    const res = await post(JUDGES[0], token);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("stale");
    expect(snapshot()).toBe(before);
  });

  it("the same proof gives the same token to every reviewer, and one favour's token does not work on another", async () => {
    await answer(ANA, "TEST DATA proof A");
    const t1 = (await dealt(JUDGES[0]))[0].proofToken;
    const t2 = (await dealt(JUDGES[1]))[0].proofToken;
    expect(t1).toBe(t2);
    const other = "house000-0000-4000-8000-000000000002";
    await seed(favour({ id: other }));
    await answer(BEN, "TEST DATA proof A", other);
    const cards = await dealt(JUDGES[0]);
    expect(new Set(cards.map((c) => c.proofToken)).size).toBe(2);
    const wrong = await reviewVote(req("/api/review/flagged", JUDGES[0], { address: JUDGES[0], caseId: other, proofToken: t1, verdict: "real", reason: "TEST DATA: judged on what this card showed." }));
    expect(wrong.status).toBe(409);
  });
});
