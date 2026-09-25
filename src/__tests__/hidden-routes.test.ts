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

const HIDDEN_AGENT: Array<Record<string, unknown>> = [];
vi.mock("@/lib/agent-analytics", () => ({ getAgentAnalytics: async () => [] }));
vi.mock("@/lib/store", () => ({
  listTasks: async () => [HIDDEN, SHOWN, ...HIDDEN_AGENT],
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

describe("R16: the remaining hidden-task reads", () => {
  it("GET /api/agent/tasks/[id] answers 404", async () => {
    const { GET } = await import("@/app/api/agent/tasks/[id]/route");
    const res = await GET(new NextRequest("http://x/api/agent/tasks/hid"), { params: Promise.resolve({ id: "hid" }) });
    expect(res.status).toBe(404);
  });
  it("the task page's link preview never carries a hidden task's text", async () => {
    const { generateMetadata } = await import("@/app/task/[id]/layout");
    const meta = await generateMetadata({ params: Promise.resolve({ id: "hid" }) });
    expect(JSON.stringify(meta)).not.toContain("make money");
  });
});

describe("R16: public pages", () => {
  it("the agent page never renders a hidden task's text", async () => {
    HIDDEN_AGENT.push({ ...HIDDEN, id: "hid2", poster: "agent:openclaw", description: "hidden agent pitch to make money" });
    const Page = (await import("@/app/agent/[id]/page")).default;
    const tree = await Page({ params: Promise.resolve({ id: "openclaw" }) } as never);
    // Collect every string in the element tree (props and children).
    const seen = new Set<unknown>();
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") { strings.push(v); return; }
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      for (const x of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) walk(x);
    };
    walk(tree);
    const text = strings.join(" ");
    expect(text).toContain("What is the smallest thing");
    expect(text).not.toContain("hidden agent pitch");
  });
});
