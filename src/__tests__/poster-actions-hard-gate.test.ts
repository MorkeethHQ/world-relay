import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POSTER ACTIONS ON THE HARD GATE (14 Oct 2026). confirm, cancel, dispute and
// feedback-tasks checked the session with ownershipError, which lets a
// mismatched or missing cookie through while SESSION_ENFORCE is off
// (production). Proven on the local TEST DATA fixture: the doer sent
// {poster: <poster wallet>, approved: true} with HIS OWN cookie on his own
// flagged proof, and got completed and 5 points. They now use ownerRefusal,
// as post, claim and verify do. Every case below runs with the switch OFF.

const spy = vi.hoisted(() => ({
  posterConfirm: vi.fn(async () => ({ id: "t1", status: "completed" })),
  cancelTask: vi.fn(async () => ({ id: "t1", status: "cancelled" })),
  mediateDispute: vi.fn(async () => ({ verdict: "pass", reasoning: "x", confidence: 0.9 })),
  awardPoints: vi.fn(async () => ({ totalPoints: 3 })),
}));
const tasks = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/store", () => ({
  getTask: async (id: string) => tasks.get(id) ?? null,
  posterConfirm: spy.posterConfirm,
  cancelTask: spy.cancelTask,
  setAttestationHash: vi.fn(), markSettled: vi.fn(), markSettlementPending: vi.fn(),
}));
vi.mock("@/lib/xmtp", () => ({ postVerificationResult: vi.fn(async () => {}), postDisputeVerdict: vi.fn(async () => {}) }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", () => ({ notifyVerified: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/reputation", () => ({ recordCompletion: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}) }));
vi.mock("@/lib/completions", () => ({ recordLatePassHistory: vi.fn(async () => {}) }));
vi.mock("@/lib/escrow", () => ({ refundEscrow: vi.fn(async () => ({})), releaseEscrow: vi.fn(async () => ({})) }));
vi.mock("@/lib/messages", () => ({ getMessages: async () => [] }));
vi.mock("@/lib/ai-chat", () => ({ mediateDispute: spy.mediateDispute }));
vi.mock("@/lib/attestation", () => ({ postAttestation: vi.fn(async () => null) }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/feedback-tasks", () => ({
  getActiveFeedbackTasks: async () => [],
  getFeedbackTemplate: () => ({ id: "tpl", pointsReward: 3 }),
}));
vi.mock("@/lib/proof-of-favour", () => ({ awardPoints: spy.awardPoints, getProofOfFavour: async () => ({ totalPoints: 0 }) }));

import { POST as CONFIRM } from "@/app/api/tasks/[id]/confirm/route";
import { POST as CANCEL } from "@/app/api/tasks/[id]/cancel/route";
import { POST as DISPUTE } from "@/app/api/tasks/[id]/dispute/route";
import { POST as FEEDBACK } from "@/app/api/feedback-tasks/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";

const POSTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DOER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const params = Promise.resolve({ id: "t1" });
const req = (path: string, body: unknown, as?: string) => {
  const token = as ? issueSessionToken(as, Date.now()) : null;
  if (as && !token) throw new Error("no session key");
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) },
    body: JSON.stringify(body),
  });
};

const ENV = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  delete process.env.SESSION_ENFORCE;
  Object.values(spy).forEach((f) => f.mockClear());
  tasks.clear();
  tasks.set("t1", {
    id: "t1", poster: POSTER, claimant: DOER, status: "claimed", rewardType: "points", bountyUsdc: 5, onChainId: null,
    description: "TEST", verificationResult: { verdict: "flag", reasoning: "x", confidence: 0.5 },
  });
});
afterEach(() => { process.env = { ...ENV }; });

describe("confirm: only the poster's own session approves", () => {
  it("the doer's cookie naming the poster is refused, and nothing is approved", async () => {
    const res = await CONFIRM(req("/api/tasks/t1/confirm", { poster: POSTER, approved: true }, DOER), { params });
    expect(res.status).toBe(403);
    expect(spy.posterConfirm).not.toHaveBeenCalled();
  });
  it("no cookie is refused", async () => {
    expect((await CONFIRM(req("/api/tasks/t1/confirm", { poster: POSTER, approved: true }), { params })).status).toBe(403);
    expect(spy.posterConfirm).not.toHaveBeenCalled();
  });
  it("the poster's own cookie gets through", async () => {
    await CONFIRM(req("/api/tasks/t1/confirm", { poster: POSTER, approved: true }, POSTER), { params });
    expect(spy.posterConfirm).toHaveBeenCalled();
  });
});

describe("cancel: only the poster's own session cancels", () => {
  it("the doer's cookie naming the poster is refused, and nothing is cancelled", async () => {
    tasks.set("t1", { ...tasks.get("t1")!, status: "open", claimant: null });
    const res = await CANCEL(req("/api/tasks/t1/cancel", { poster: POSTER }, DOER), { params });
    expect(res.status).toBe(403);
    expect(spy.cancelTask).not.toHaveBeenCalled();
  });
});

describe("dispute: only the poster's own session starts a mediation", () => {
  it("the doer's cookie naming the poster is refused, and no model is called", async () => {
    const res = await DISPUTE(req("/api/tasks/t1/dispute", { poster: POSTER }, DOER), { params });
    expect(res.status).toBe(403);
    expect(spy.mediateDispute).not.toHaveBeenCalled();
  });
});

describe("feedback-tasks: points only to the session's own wallet", () => {
  it("another wallet's cookie naming this address is refused, and no point is awarded", async () => {
    const res = await FEEDBACK(req("/api/feedback-tasks", { address: POSTER, templateId: "tpl", response: "an honest answer" }, DOER));
    expect(res.status).toBe(403);
    expect(spy.awardPoints).not.toHaveBeenCalled();
  });
});
