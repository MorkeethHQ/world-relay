import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// R16 WIRING. lead-card.test.ts covers the rule; this file calls the real GET
// handlers, so removing the hidden filter from any public read turns this red.
// Found missing by the independent review of PR #44: detail, search and the
// agent list returned hidden tasks while GET /api/tasks did not.

const base = {
  claimant: null, category: "feedback", location: "Anywhere", lat: null, lng: null, bountyUsdc: 5,
  deadline: "2099-01-01T00:00:00Z", status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
  verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null,
  callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard",
  rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false, pendingRelease: false,
  maxCompletions: 10, completionCount: 0, createdAt: "2026-09-24T00:00:00Z",
};
const HIDDEN = { ...base, id: "hid", poster: "0xbb7e4f130f38aaaaaaaaaaaaaaaaaaaaaaaaaaaa", description: "just want to make money", hiddenAt: "2026-09-25T12:00:00Z", hiddenReason: "spam" };
const SHOWN = { ...base, id: "ok", poster: "agent:openclaw", description: "What is the smallest thing that made your day better today?" };

vi.mock("@/lib/store", () => ({
  listTasks: async () => [HIDDEN, SHOWN],
  getTask: async (id: string) => [HIDDEN, SHOWN].find((t) => t.id === id),
  createTask: async () => null,
  setOnChainId: async () => {},
}));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/api-keys", () => ({ checkAgentAuth: async () => ({ authenticated: true }) }));

const ids = (body: { tasks: Array<{ id: string }> }) => body.tasks.map((t) => t.id);

describe("R16: no public read returns an operator-hidden task", () => {
  it("GET /api/tasks", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    expect(ids(await (await GET()).json())).toEqual(["ok"]);
  });
  it("GET /api/tasks/search", async () => {
    const { GET } = await import("@/app/api/tasks/search/route");
    const res = await GET(new NextRequest("http://x/api/tasks/search?q=money"));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("hid");
  });
  it("GET /api/agent/tasks", async () => {
    const { GET } = await import("@/app/api/agent/tasks/route");
    const res = await GET(new NextRequest("http://x/api/agent/tasks?status=all"));
    expect(ids(await res.json())).toEqual(["ok"]);
  });
  it("GET /api/tasks/[id] answers 404 for a hidden task, 200 for a shown one", async () => {
    const { GET } = await import("@/app/api/tasks/[id]/route");
    const hidden = await GET(new NextRequest("http://x/api/tasks/hid"), { params: Promise.resolve({ id: "hid" }) });
    expect(hidden.status).toBe(404);
    const shown = await GET(new NextRequest("http://x/api/tasks/ok"), { params: Promise.resolve({ id: "ok" }) });
    expect(shown.status).toBe(200);
  });
});
