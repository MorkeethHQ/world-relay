import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GUARD: every ENTER path into the escrow, exercised — not grepped.
 *
 * The first custody guard asserted three layers (encoders / UI / POST /api/tasks)
 * and called the way in closed. It was not. A multi-model review found four more
 * routes that could still bind or create escrow funding, and they are the reason
 * this file is behavioural: each case below drives the actual route handler or
 * library function, so reopening one goes red rather than silently shipping.
 *
 * The paths that survived the first pass:
 *   1. POST /api/agent/tasks with `fund: true` → createEscrowTaskWithKey, which
 *      approves and deposits real USDC from a server-held key.
 *   2. The same route's Path A (escrow_tx_hash + on_chain_id).
 *   3. PATCH /api/tasks/[id], which bound onChainId/escrowTxHash with no gate.
 *   4. POST /api/seed, the bulk path every historical funded task arrived through.
 *
 * DELIBERATELY STILL OPEN, do not "fix": releaseEscrow, refundEscrow, and the
 * reconcile/expire crons. Historical Open/Claimed rows still need to settle or
 * refund, and those are EXIT paths. This file guards ENTER only.
 */

const SECRET = vi.hoisted(() => {
  process.env.ADMIN_SECRET = "test-custody-secret";
  return "test-custody-secret";
});

vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackReach: async () => {} }));

const escrowCalls: string[] = [];
vi.mock("@/lib/escrow", async (orig) => {
  const actual = await orig<typeof import("@/lib/escrow")>();
  return {
    ...actual,
    // Record any attempt to reach the chain. A gated route must never get here.
    createEscrowTaskWithKey: async (...a: unknown[]) => {
      escrowCalls.push("createEscrowTaskWithKey");
      return actual.createEscrowTaskWithKey(...(a as Parameters<typeof actual.createEscrowTaskWithKey>));
    },
    isEscrowTaskFunded: async () => {
      escrowCalls.push("isEscrowTaskFunded");
      return true;
    },
  };
});

const req = (body: unknown, url = "http://localhost/api/agent/tasks") =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "rlk_test" },
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  escrowCalls.length = 0;
});

describe("ENTER path 1+2 — POST /api/agent/tasks funding methods", () => {
  const base = {
    description: "Photograph the notice board outside your local library",
    location: "Paris",
    bounty_usdc: 5,
  };

  it("refuses `fund: true` with 410 and never reaches the chain", async () => {
    const { POST } = await import("@/app/api/agent/tasks/route");
    const res = await POST(req({ ...base, fund: true }));
    expect(res.status).toBe(410);
    expect(escrowCalls, "a gated route must not touch escrow").toEqual([]);
  });

  it("refuses Path A (escrow_tx_hash + on_chain_id) with 410", async () => {
    const { POST } = await import("@/app/api/agent/tasks/route");
    const res = await POST(
      req({ ...base, escrow_tx_hash: `0x${"a".repeat(64)}`, on_chain_id: 23 })
    );
    expect(res.status).toBe(410);
    expect(escrowCalls).toEqual([]);
  });

  it("refuses on_chain_id alone — 0 is a valid task id and must not slip through", async () => {
    const { POST } = await import("@/app/api/agent/tasks/route");
    const res = await POST(req({ ...base, on_chain_id: 0 }));
    expect(res.status).toBe(410);
  });
});

describe("ENTER path 3 — PATCH /api/tasks/[id] escrow binding", () => {
  it("refuses to bind an escrow deposit to a task", async () => {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const request = new Request("http://localhost/api/tasks/abc", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onChainId: 23, escrowTxHash: `0x${"b".repeat(64)}` }),
    });
    const res = await PATCH(request as never, { params: Promise.resolve({ id: "abc" }) } as never);
    expect(res.status).toBe(410);
  });
});

describe("ENTER path 4 — POST /api/seed funded markers", () => {
  const seedTask = {
    description: "Photograph the notice board outside your local library",
    location: "Paris",
    category: "custom",
    deadlineHours: 24,
  };

  // Authenticated on purpose. Without the secret the route 401s before it ever
  // reaches validation, and the case would pass whether or not the gate exists.
  const seed = async (tasks: unknown[]) => {
    const { POST } = await import("@/app/api/seed/route");
    return POST(req({ secret: SECRET, tasks }, "http://localhost/api/seed"));
  };

  it("rejects a seeded task carrying escrow funding", async () => {
    const res = await seed([
      { ...seedTask, bountyUsdc: 5, onChainId: 41, escrowTxHash: `0x${"c".repeat(64)}` },
    ]);
    expect(res.status, "a funded seed must not be accepted").toBe(400);
  });

  it("still accepts a points-only seed — retirement must not break seeding", async () => {
    const res = await seed([{ ...seedTask, bountyUsdc: 5, rewardType: "points" }]);
    expect(res.status, "points seeding must survive custody retirement").toBe(201);
  });
});

describe("ENTER path 5 — the library functions themselves", () => {
  it("createEscrowTaskWithKey short-circuits before touching the chain", async () => {
    const actual = await vi.importActual<typeof import("@/lib/escrow")>("@/lib/escrow");
    const started = Date.now();
    const out = await actual.createEscrowTaskWithKey(`0x${"1".repeat(64)}`, "x", 5, 24);
    expect(out).toBeNull();
    // A null from a failed RPC round-trip would take far longer. This asserts the
    // gate is the first statement, not that the network happened to be down.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("createAgentTask and the deposit/withdraw encoders cannot run", async () => {
    const ae = await vi.importActual<typeof import("@/lib/agent-escrow")>("@/lib/agent-escrow");
    await expect(
      ae.createAgentTask("0x1101158041fd96f21cbcbb0e752a9a2303e6d70e", "x", 5, 24)
    ).resolves.toBeNull();
    expect(ae.encodeAgentDeposit(5)).toBeNull();
    expect(ae.encodeAgentWithdraw(5)).toBeNull();
  });
});

describe("EXIT paths stay open on purpose", () => {
  it("keeps settlement and refund available for historical rows", async () => {
    const actual = await vi.importActual<typeof import("@/lib/escrow")>("@/lib/escrow");
    // Not called here — merely asserting they still EXIST. Historical Open and
    // Claimed tasks predate retirement and must still be able to settle or
    // refund; gating these would strand real money.
    expect(typeof actual.releaseEscrow).toBe("function");
    expect(typeof actual.refundEscrow).toBe("function");
  });
});
