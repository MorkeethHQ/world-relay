import { describe, it, expect, beforeEach, vi } from "vitest";

// Route-level guard for the privilege/identity split.
//
// seeder.test.ts covers the RULE (resolvePostingPrivilege). This file covers the
// WIRING: that POST /api/tasks actually applies it. Without this, someone could
// restore `isAdmin = !!resolvedAgentId` in the route and every seeder test would
// stay green — the same "guard that doesn't guard" failure that let the Jul 12
// escrow drain regress unnoticed behind a passing grep.
//
// Verified by mutation: restoring the old expression turns the Claim 1 cases here
// red while every seeder.test.ts case stays green.

const created: any[] = [];
let existing: any[] = [];

vi.mock("@/lib/store", () => ({
  createTask: async (input: any) => {
    const task = { id: `t${created.length + 1}`, ...input, agent: null, createdAt: new Date().toISOString() };
    created.push(task);
    return task;
  },
  listTasks: async () => existing,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/escrow", () => ({ isEscrowTaskFunded: async () => false }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/proof-of-favour", () => ({ recordFavourPosted: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { POST } from "@/app/api/tasks/route";

const OWNER = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";
const SECRET = "test-seed-secret";

function req(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

const points = (poster: string, over = {}) => ({
  poster,
  description: "Check whether the bakery on rue de Bretagne still has the almond croissants",
  location: "Paris",
  bountyUsdc: 5,
  deadlineHours: 24,
  rewardType: "points",
  ...over,
});

beforeEach(() => {
  created.length = 0;
  existing = [];
  process.env.ADMIN_SECRET = SECRET;
  delete process.env.SEED_AUTH_ENFORCE;
});

describe("Claim 3 (safety net): seeding still works while dormant", () => {
  it("agent:relay keeps its exemption with SEED_AUTH_ENFORCE unset", async () => {
    // Prior post today: a non-exempt poster would be throttled by this.
    existing = [{ poster: "agent:relay", rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points("agent:relay")));
    expect(res.status).toBe(201);
    expect(created).toHaveLength(1);
  });

  it("agent:relay may exceed the 1-10 points cap while dormant, as today", async () => {
    const res = await POST(req(points("agent:relay", { bountyUsdc: 25 })));
    expect(res.status).toBe(201);
  });
});

describe("Claim 1: the exemption requires auth once enforced", () => {
  beforeEach(() => {
    process.env.SEED_AUTH_ENFORCE = "true";
  });

  it("ENFORCED: an unauthenticated agent: poster is throttled like anyone else", async () => {
    existing = [{ poster: "agent:relay", rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points("agent:relay")));
    expect(res.status).toBe(429);
    expect(created).toHaveLength(0);
  });

  it("ENFORCED: an unauthenticated agent: poster obeys the 1-10 points cap", async () => {
    const res = await POST(req(points("agent:relay", { bountyUsdc: 999 })));
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("ENFORCED: a stranger cannot buy the exemption with a real agent name", async () => {
    const res = await POST(req(points("agent:shelfwatch", { bountyUsdc: 999 })));
    expect(res.status).toBe(400);
  });

  it("ENFORCED: the seed secret restores the exemption", async () => {
    existing = [{ poster: "agent:relay", rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points("agent:relay"), { "x-seed-secret": SECRET }));
    expect(res.status).toBe(201);
  });

  it("ENFORCED: a wrong secret does not", async () => {
    const res = await POST(req(points("agent:relay", { bountyUsdc: 999 }), { "x-seed-secret": "nope" }));
    expect(res.status).toBe(400);
  });

  it("ENFORCED: the owner address still posts freely", async () => {
    existing = [{ poster: OWNER, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(OWNER)));
    expect(res.status).toBe(201);
  });
});

describe("Claim 2: identity reaches the store, unknown ids do not masquerade", () => {
  it("a real registry id is passed to createTask", async () => {
    await POST(req(points("agent:shelfwatch"), { "x-seed-secret": SECRET }));
    expect(created[0].agentId).toBe("shelfwatch");
  });

  it("agent:relay resolves to NO agent id (it is a seeder, not an agent)", async () => {
    await POST(req(points("agent:relay")));
    expect(created[0].agentId).toBeNull();
  });

  it("an unknown agent id is surfaced, not silently swallowed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(req(points("agent:relay")));
    expect(spy.mock.calls.some((c) => String(c[0]).includes("UNKNOWN agentId"))).toBe(true);
    spy.mockRestore();
  });
});
