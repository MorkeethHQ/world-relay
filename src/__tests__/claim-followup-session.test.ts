import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";

// Two write routes the 2026-10-13 route audit found open. TEST DATA throughout.
//
// POST /api/tasks/[id]/claim ran the session gate only for a company task; on
// every other task body.claimant went straight to claimTask and to
// recordFavourClaimed (points). POST /api/tasks/[id]/followup read no identity
// at all: anyone who knew a task id could re-run the AI follow-up on another
// person's proof, and a pass ends in points, reputation and an escrow release.
// Both now sit behind the session switch: claim through ownershipError on
// body.claimant, followup through readerRefusal over the claimant and poster.

const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
const ai = vi.hoisted(() => ({ followUpCalls: 0 }));

vi.mock("@/lib/redis", () => ({ getRedis: () => mem.current!.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/verification-tier", () => ({ tierGateError: async () => null, getUserVerificationLevel: async () => "orb" }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: vi.fn(async () => null), resolveDon: vi.fn(async () => null) }));
vi.mock("@/lib/xmtp", () => ({
  postClaimNotification: async () => {}, postClaimBriefing: async () => {}, syncAndProcessMessages: async () => {},
  postReEvaluationResult: async () => {},
}));
vi.mock("@/lib/ai-chat", () => ({
  generateClaimBriefing: async () => null,
  evaluateFollowUp: async () => { ai.followUpCalls += 1; return { verdict: "pass", confidence: 0.9, reasoning: "TEST DATA" }; },
}));
vi.mock("@/lib/notifications", () => ({ notifyTaskClaimed: async () => {}, notifyVerified: async () => {}, notifyFlagged: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async () => null }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));
vi.mock("@/lib/contribution-responses", () => ({ campaignIntakePaused: async () => false }));

import { POST as claimRoute } from "@/app/api/tasks/[id]/claim/route";
import { POST as followupRoute } from "@/app/api/tasks/[id]/followup/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { createTask, getTask } from "@/lib/store";
import { addMessage } from "@/lib/messages";

const POSTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLAIMANT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STRANGER = "0x1111111111111111111111111111111111111111";

function cookie(addr: string) {
  return { cookie: `${SESSION_COOKIE}=${issueSessionToken(addr, Date.now())}` };
}
const claim = (id: string, body: unknown, as?: string) =>
  claimRoute(new Request(`http://localhost/api/tasks/${id}/claim`, {
    method: "POST", headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) }, body: JSON.stringify(body),
  }) as any, { params: Promise.resolve({ id }) });
const followup = (id: string, as?: string) =>
  followupRoute(new Request(`http://localhost/api/tasks/${id}/followup`, {
    method: "POST", headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) }, body: "{}",
  }) as any, { params: Promise.resolve({ id }) });

async function openPointsTask() {
  return createTask({
    poster: POSTER, category: "custom", description: "TEST DATA: a points favour", location: "Anywhere",
    lat: null, lng: null, bountyUsdc: 2, deadlineHours: 24, onChainId: null, escrowTxHash: null,
    taskType: "standard", rewardType: "points", donOnChainId: null, maxCompletions: 1,
  } as any);
}

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
beforeEach(() => {
  mem.current = createMemoryRedis();
  process.env.SESSION_SECRET = "test-secret";
  process.env.SESSION_ENFORCE = "true";
  ai.followUpCalls = 0;
});
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
});

describe("POST /api/tasks/[id]/claim on an ordinary task", () => {
  it("refuses a body claimant with no session and does not claim", async () => {
    const t = await openPointsTask();
    expect((await claim(t.id, { claimant: CLAIMANT })).status).toBe(403);
    expect((await getTask(t.id))!.status).toBe("open");
  });

  it("refuses a session for a different wallet", async () => {
    const t = await openPointsTask();
    expect((await claim(t.id, { claimant: CLAIMANT }, STRANGER)).status).toBe(403);
    expect((await getTask(t.id))!.claimant).toBeNull();
  });

  it("lets the wallet that holds the session claim", async () => {
    const t = await openPointsTask();
    const res = await claim(t.id, { claimant: CLAIMANT }, CLAIMANT);
    expect(res.status).toBe(200);
    expect((await getTask(t.id))!.claimant).toBe(CLAIMANT);
  });

  it("ships dark: switch off, the anonymous claim still goes through", async () => {
    delete process.env.SESSION_ENFORCE;
    const t = await openPointsTask();
    expect((await claim(t.id, { claimant: CLAIMANT })).status).toBe(200);
  });
});

describe("POST /api/tasks/[id]/followup", () => {
  async function pendingFollowUp() {
    const t = await openPointsTask();
    await claim(t.id, { claimant: CLAIMANT }, CLAIMANT);
    const stored = (await getTask(t.id))!;
    stored.proofImageUrl = "data:image/jpeg;base64,AAAA";
    stored.proofImages = [stored.proofImageUrl];
    stored.aiFollowUp = { question: "TEST DATA: which door?", status: "pending", initialConfidence: 0.4 } as any;
    await mem.current!.client.set(`task:${t.id}`, JSON.stringify(stored));
    await addMessage(t.id, "relay-bot", "AI FOLLOW-UP: which door?");
    await addMessage(t.id, CLAIMANT, "the blue one");
    return t.id;
  }

  it("answers 401 with no session and never calls the model", async () => {
    const id = await pendingFollowUp();
    expect((await followup(id)).status).toBe(401);
    expect(ai.followUpCalls).toBe(0);
  });

  it("answers 403 to a stranger with their own session", async () => {
    const id = await pendingFollowUp();
    expect((await followup(id, STRANGER)).status).toBe(403);
    expect(ai.followUpCalls).toBe(0);
  });

  it("runs for the claimant", async () => {
    const id = await pendingFollowUp();
    const res = await followup(id, CLAIMANT);
    expect(res.status).toBe(200);
    expect(ai.followUpCalls).toBe(1);
  });
});
