import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Behavioral guard: POST /api/agent/tasks must not enter escrow while custody
 * is retired. Complements the source-grep guards in custody-retired.guard.test.ts.
 */

vi.mock("@/lib/api-keys", () => ({
  checkAgentAuth: vi.fn(async () => ({ authenticated: true, agentId: "test" })),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/store", () => ({
  createTask: vi.fn(async (input: Record<string, unknown>) => ({
    id: "task-1",
    poster: input.poster,
    description: input.description,
    location: input.location,
    bountyUsdc: input.bountyUsdc,
    rewardType: input.rewardType,
    onChainId: input.onChainId ?? null,
    escrowTxHash: input.escrowTxHash ?? null,
    status: "open",
    deadline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    agent: null,
  })),
  listTasks: vi.fn(async () => []),
  getTask: vi.fn(),
}));

vi.mock("@/lib/xmtp", () => ({ postTaskCreated: vi.fn(async () => {}) }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: vi.fn() }));
vi.mock("@/lib/ai-chat", () => ({
  generateLocationBriefing: vi.fn(async () => null),
}));
vi.mock("@/lib/messages", () => ({ addMessage: vi.fn(async () => {}) }));

const createEscrowTaskWithKey = vi.fn();
vi.mock("@/lib/escrow", () => ({
  createEscrowTaskWithKey: (...args: unknown[]) => createEscrowTaskWithKey(...args),
  isEscrowTaskFunded: vi.fn(),
}));

import { POST } from "@/app/api/agent/tasks/route";
import { createTask } from "@/lib/store";
import { CUSTODY_RETIRED } from "@/lib/custody";

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST /api/agent/tasks under custody retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expect(CUSTODY_RETIRED).toBe(true);
  });

  it("returns 410 when fund:true (enter path)", async () => {
    const res = await POST(req({
      description: "Photo the door",
      location: "Paris",
      bounty_usdc: 5,
      fund: true,
      agent_id: "test",
    }));
    expect(res.status).toBe(410);
    expect(createEscrowTaskWithKey).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("returns 410 when escrow_tx_hash + on_chain_id are sent (bind path)", async () => {
    const res = await POST(req({
      description: "Photo the door",
      location: "Paris",
      bounty_usdc: 5,
      escrow_tx_hash: "0x" + "ab".repeat(32),
      on_chain_id: 7,
    }));
    expect(res.status).toBe(410);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("posts a points favour with no escrow when funding fields are omitted", async () => {
    const res = await POST(req({
      description: "Photo the door",
      location: "Paris",
      bounty_usdc: 5,
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.task.rewardType).toBe("points");
    expect(json.task.onChainId).toBeNull();
    expect(json.funding.method).toBe("points");
    expect(json.escrow_contract).toBeUndefined();
    expect(createEscrowTaskWithKey).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        rewardType: "points",
        onChainId: null,
        escrowTxHash: null,
        bountyUsdc: 5,
      })
    );
  });
});
