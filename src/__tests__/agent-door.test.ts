import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AGENT DOOR — the 10-line bot-author path (docs/AGENT-DOOR.md).
 *
 * Wiring test, not a rule test: it drives POST /api/agent/tasks with the
 * MINIMAL body a bot author with no context would send (three fields + the
 * API key) and pins what that author is told back.
 *
 * Two things it guards, each a real defect found 2026-09-03:
 *   1. The response said "waiting for a human to fund it via World App" for a
 *      flow whose UI was retired with custody. A bot author reading that would
 *      wait for money that never moves. The response must say POINTS.
 *   2. `agent_` — the poster prefix this route stamps on every favour — sat in
 *      isPublicTask's TEST_IDENTITY regex, so no human could ever see a
 *      bot-posted favour on the board. The door was dark at the board, not
 *      just at the money.
 */

vi.hoisted(() => {
  process.env.AGENT_API_KEY = "rlk_agent_door_test";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

const created: any[] = [];
vi.mock("@/lib/store", () => ({
  createTask: async (input: any) => {
    const task = {
      id: `t${created.length + 1}`,
      status: "open",
      deadline: new Date(Date.now() + input.deadlineHours * 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      agent: null,
      onChainId: input.onChainId ?? null,
      escrowTxHash: input.escrowTxHash ?? null,
      // Mirrors store.ts: custody retired → an omitted rewardType is points.
      rewardType: input.rewardType || "points",
      ...input,
    };
    created.push(task);
    return task;
  },
  listTasks: async () => created,
  getTask: async (id: string) => created.find((t) => t.id === id) ?? null,
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/escrow", () => ({
  isEscrowTaskFunded: async () => false,
  createEscrowTaskWithKey: async () => null,
}));

import { POST } from "@/app/api/agent/tasks/route";
import { isPublicTask } from "@/lib/task-serializer";

const MINIMAL = {
  description: "Photo of the opening-hours sign at 12 Rue de Rivoli, sign fully readable",
  location: "Paris",
  bounty_usdc: 3,
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost/api/agent/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  created.length = 0;
});

describe("POST /api/agent/tasks — minimal body", () => {
  it("three fields + Bearer key → 201, points favour, honest message", async () => {
    const res = await post(MINIMAL, { authorization: "Bearer rlk_agent_door_test" });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(created).toHaveLength(1);
    expect(body.task.id).toBe("t1");
    expect(body.task.status).toBe("open");
    expect(body.task.poster).toMatch(/^agent_/);
    expect(body.task.bountyUsdc).toBe(3);
    // Never conflate points and USDC (CLAUDE.md): the author is told which.
    expect(body.task.rewardType).toBe("points");
    expect(body.funding.funded).toBe(false);
    expect(body.funding.message).toMatch(/point favour/);
    expect(body.funding.message).not.toMatch(/fund it via World App/);
    expect(body.funding.fund_url).toBeUndefined();
    expect(body.funding.task_url).toBe("https://world-relay.vercel.app/task/t1");
  });

  it("a bot-posted favour is PUBLIC — a human can see it on the board", async () => {
    const res = await post(MINIMAL, { authorization: "Bearer rlk_agent_door_test" });
    const { task } = await res.json();
    expect(isPublicTask(task)).toBe(true);
    // The retired test identities stay hidden; only agent_ was wrongly swept in.
    expect(isPublicTask({ ...task, poster: "dev_abc" })).toBe(false);
    expect(isPublicTask({ ...task, poster: "demo_abc" })).toBe(false);
    expect(isPublicTask({ ...task, poster: "e2e_abc" })).toBe(false);
  });

  it("no key → 401 with the header hint; nothing created", async () => {
    const res = await post(MINIMAL);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hint).toMatch(/Authorization: Bearer/);
    expect(created).toHaveLength(0);
  });

  it("missing a field → 400 that tells the truth about the reward", async () => {
    const res = await post({ description: MINIMAL.description }, { authorization: "Bearer rlk_agent_door_test" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.required).toEqual(["description", "location", "bounty_usdc"]);
    expect(body.funding_methods).toBeUndefined();
    expect(body.reward).toMatch(/POINTS/);
    expect(created).toHaveLength(0);
  });
});
