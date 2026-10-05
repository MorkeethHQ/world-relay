import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";

// A RESOLVED APPEAL SETTLES THE FAVOUR (2026-10-05). TEST DATA.
// A plain points favour with a flagged photo is decided by three qualified
// judges through the real routes. Before this, the decision moved points and
// left the favour "claimed", so a favour many people could answer stayed held.
const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
vi.mock("@/lib/redis", () => ({ getRedis: () => mem.current!.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));

import { GET as deck, POST as vote } from "@/app/api/jury/appeal/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getTask } from "@/lib/store";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { listContributions } from "@/lib/completions";
import type { Task } from "@/lib/types";
import type { NextRequest } from "next/server";

const SENDER = "0x7e57da7a000000000000000000000000000000a1";
const JUDGES = ["0x7e57da7a000000000000000000000000000000c1", "0x7e57da7a000000000000000000000000000000c2", "0x7e57da7a000000000000000000000000000000c3"];
const ID = "plain000-0000-4000-8000-000000000001";

function req(url: string, wallet: string, body?: unknown): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}
function flagged(over: Partial<Task> = {}): Task {
  return {
    id: ID, poster: "agent:relay", claimant: SENDER, category: "photo", description: "TEST DATA favour: photo the nearest door",
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 8, deadline: "2027-01-01T00:00:00.000Z", status: "claimed",
    proofSubmissionId: "p1", proofImageUrl: "https://blob.test/door.jpg", proofImages: ["https://blob.test/door.jpg"], proofNote: "TEST DATA door",
    verificationResult: { verdict: "flag", reasoning: "TEST DATA: not sure", confidence: 0.5 }, attestationTxHash: null, agent: null,
    aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard",
    rewardType: "points", donOnChainId: null, donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 100, completionCount: 4, createdAt: "2026-10-01T00:00:00.000Z", ...over,
  };
}
async function decide(verdicts: Array<"real" | "not">) {
  const out = [];
  for (const [i, v] of verdicts.entries()) {
    const cards = (await (await deck(req("/api/jury/appeal", JUDGES[i]))).json()).cards as Array<{ cardId: string }>;
    expect(cards.length, `judge ${i + 1} is dealt the flagged proof`).toBe(1);
    out.push(await (await vote(req("/api/jury/appeal", JUDGES[i], { address: JUDGES[i], cardId: cards[0].cardId, verdict: v }))).json());
  }
  return out;
}

beforeEach(async () => {
  mem.current = createMemoryRedis();
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  await mem.current.client.set(`task:${ID}`, JSON.stringify(flagged()));
  await mem.current.client.sadd("task_ids", ID);
  for (const j of JUDGES) await mem.current.client.hset(`jury:stats:${j}`, { judged: 12, correct: 10 });
});

describe("a flagged photo on a plain points favour, decided by the jury", () => {
  it("accepted: points once, a History row, the reply counted and the favour open again for others", async () => {
    const results = await decide(["real", "not", "real"]);
    expect(results.map((r) => r.outcome)).toEqual(["pending", "pending", "cleared"]);
    expect(results[2].pointsAwardedToClaimant).toBe(8);
    expect((await getProofOfFavour(SENDER)).totalPoints).toBe(8);
    const t = (await getTask(ID))!;
    expect(t.status).toBe("open");
    expect(t.claimant).toBeNull();
    expect(t.completionCount).toBe(5);
    expect(await mem.current!.client.sismember(`completed_claimants:${ID}`, SENDER)).toBe(1);
    const rows = await listContributions(SENDER);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBe(ID);
  });

  it("declined: no points, and the favour opens again instead of staying held", async () => {
    const results = await decide(["not", "not", "real"]);
    expect(results[2].outcome).toBe("upheld");
    expect((await getProofOfFavour(SENDER)).totalPoints).toBe(0);
    const t = (await getTask(ID))!;
    expect(t.status).toBe("open");
    expect(t.claimant).toBeNull();
    expect(t.completionCount).toBe(4);
    expect(await listContributions(SENDER)).toHaveLength(0);
  });

  it("before the quorum, nothing about the favour changes", async () => {
    const before = mem.current!.raw(`task:${ID}`);
    await decide(["real", "real"]);
    expect(mem.current!.raw(`task:${ID}`)).toBe(before);
    expect((await getProofOfFavour(SENDER)).totalPoints).toBe(0);
  });

  it("a favour with money on it is never dealt, so it can never be settled here", async () => {
    await mem.current!.client.set(`task:${ID}`, JSON.stringify(flagged({ onChainId: 5, escrowTxHash: `0x${"c".repeat(64)}`, rewardType: "usdc", maxCompletions: 1 })));
    const cards = (await (await deck(req("/api/jury/appeal", JUDGES[0]))).json()).cards;
    expect(cards).toHaveLength(0);
  });
});
