import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * ROUTE-LEVEL WIRING for BOARD-RULES.md R8.
 *
 * board-visibility.guard.test.ts covers the RULE (isPublicTask lets the agent
 * namespace through). This file covers the WIRING: that a task posted to the
 * real POST /api/agent/tasks handler actually comes back out of the real
 * GET /api/tasks handler. That is the assertion whose absence let the live
 * defect exist — the filter and the mint were each defensible on their own and
 * only their COMBINATION was broken, so no unit test could have caught it.
 *
 * Both handlers are the real modules; only their side-effecting dependencies
 * (store, redis, xmtp, auth, rate limits) are mocked, and the store mock
 * reproduces src/lib/store.ts createTask defaults — including
 * `rewardType: "points"` under CUSTODY_RETIRED, which board-rank R3 needs to
 * consider the task visible at all.
 *
 * Verified by mutation: restoring `agent_` to TEST_IDENTITY turns the first
 * case here red.
 */

const created: any[] = [];
let existing: any[] = [];

vi.mock("@/lib/store", () => ({
  createTask: async (input: any) => {
    // Mirrors src/lib/store.ts createTask. If that drifts, this mock is lying.
    const task = {
      id: `t${created.length + 1}`,
      poster: input.poster,
      claimant: null,
      category: input.category || "custom",
      description: input.description,
      location: input.location,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      bountyUsdc: input.bountyUsdc,
      deadline: new Date(Date.now() + input.deadlineHours * 3600_000).toISOString(),
      status: "open",
      proofImageUrl: null,
      proofImages: null,
      proofNote: null,
      verificationResult: null,
      attestationTxHash: null,
      agent: null,
      aiFollowUp: null,
      recurring: null,
      callbackUrl: input.callbackUrl ?? null,
      onChainId: input.onChainId ?? null,
      escrowTxHash: input.escrowTxHash ?? null,
      claimCode: null,
      taskType: input.taskType || "standard",
      rewardType: input.rewardType || "points",
      donOnChainId: null,
      donStakeTxHash: null,
      claimantVerification: null,
      requiresClaim: false,
      pendingRelease: false,
      maxCompletions: input.maxCompletions ?? 1,
      completionCount: 0,
      createdAt: new Date().toISOString(),
    };
    created.push(task);
    existing.push(task);
    return task;
  },
  listTasks: async () => existing,
  getTask: async (id: string) => existing.find((t) => t.id === id) || null,
}));

vi.mock("@/lib/api-keys", () => ({
  checkAgentAuth: async () => ({ authenticated: true, agentId: "smoke-probe" }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/escrow", () => ({
  isEscrowTaskFunded: async () => false,
  createEscrowTaskWithKey: async () => null,
}));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/proof-of-favour", () => ({ recordFavourPosted: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { POST as AGENT_POST } from "@/app/api/agent/tasks/route";
import { GET as BOARD_GET } from "@/app/api/tasks/route";

function agentReq(body: any) {
  return new Request("http://localhost/api/agent/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer rlk_test" },
    body: JSON.stringify(body),
  }) as any;
}

const favour = (over = {}) => ({
  description: "Check whether the water fountain in the square is actually running today",
  location: "Paris",
  bounty_usdc: 5,
  deadline_hours: 24,
  ...over,
});

async function boardIds(): Promise<string[]> {
  const res = await BOARD_GET();
  const body = await res.json();
  return body.tasks.map((t: any) => t.id);
}

beforeEach(() => {
  created.length = 0;
  existing = [];
});

describe("a favour posted through the public Agent API reaches the public board", () => {
  it("POST /api/agent/tasks -> the task id is in GET /api/tasks", async () => {
    const res = await AGENT_POST(agentReq(favour({ agent_id: "smoke-probe" })));
    expect(res.status).toBe(201);
    const { task } = await res.json();

    // The mint this whole rule depends on. Asserted here, not assumed, because
    // if it ever changes the visibility outcome changes with it.
    expect(task.poster).toBe("agent_smoke-probe");
    expect(await boardIds()).toContain(task.id);
  });

  it("also when no agent_id is given (the route mints a random agent_ poster)", async () => {
    const res = await AGENT_POST(agentReq(favour()));
    const { task } = await res.json();
    expect(task.poster).toMatch(/^agent_/);
    expect(await boardIds()).toContain(task.id);
  });
});

describe("controls: the board still drops what it should", () => {
  it("a dev_ task in the same store is NOT on the board", async () => {
    // Same store, same request, same ranking — the only difference is the
    // poster prefix. If this passed too, R8 would be doing nothing.
    await AGENT_POST(agentReq(favour({ agent_id: "smoke-probe" })));
    const devTask = { ...created[0], id: "dev-task", poster: "dev_1a1390db" };
    existing.push(devTask);

    const ids = await boardIds();
    expect(ids).toContain(created[0].id);
    expect(ids).not.toContain("dev-task");
  });

  it("a funding attempt is still refused with 410 before anything is created", async () => {
    // Custody retirement is upstream of all of this and must not have moved.
    const res = await AGENT_POST(agentReq(favour({ fund: true })));
    expect(res.status).toBe(410);
    expect(created).toHaveLength(0);
  });
});
