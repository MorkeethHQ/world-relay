import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";

const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      mockStore.set(key, value);
      return "OK";
    },
    del: async () => 1,
    sadd: async () => 1,
    smembers: async (key: string) => Array.from(mockSets.get(key) || []),
    sismember: async (key: string, member: string) =>
      mockSets.get(key)?.has(member) ? 1 : 0,
    incr: async () => 1,
    expire: async () => 1,
  }),
}));

vi.mock("@/lib/store", () => ({
  listTasks: async () => tasksFixture,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/session", () => ({ ownershipError: () => null }));
vi.mock("@/lib/proof-of-favour", () => ({
  awardPoints: async () => ({}),
}));

import { GET, POST } from "@/app/api/jury/route";

const JUDGE = "0x" + "9".repeat(40);
let tasksFixture: Task[] = [];
let seq = 0;

function doneTask(overrides: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `route-jt${seq}`,
    poster: "agent:relay",
    claimant: "0x" + String(seq).padStart(40, "0"),
    category: "photo",
    description: `proofable favour number ${seq} with a proper spec`,
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 5,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "completed",
    proofImageUrl: `data:image/jpeg;base64,x${seq}`,
    proofImages: null,
    proofNote: "did it",
    verificationResult: { verdict: "pass", reasoning: "ok", confidence: 0.9 },
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    claimantVerification: "wallet",
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1,
    completionCount: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

function openBridge(overrides: Partial<Task> = {}): Task {
  return doneTask({
    id: "route-bridge",
    status: "open",
    claimant: null,
    category: "feedback",
    description: "Share one honest opinion about a product you used this week in two sentences.",
    location: "Anywhere",
    proofImageUrl: null,
    proofNote: null,
    verificationResult: null,
    completionCount: 0,
    bountyUsdc: 5,
    poster: "0x" + "d".repeat(40),
    ...overrides,
  });
}

beforeEach(() => {
  mockStore.clear();
  mockSets.clear();
  tasksFixture = [];
  seq = 0;
});

describe("GET /api/jury return bridge contract", () => {
  it("returns exhausted + bridgeFavour + counts when deck cannot compose", async () => {
    const p1 = doneTask();
    const p2 = doneTask();
    const favour = openBridge();
    mockSets.set(`jury:judged:${JUDGE.toLowerCase()}`, new Set([p1.id, p2.id]));
    tasksFixture = [p1, p2, favour];

    const res = await GET(
      new Request(`http://localhost/api/jury?address=${JUDGE}`) as any
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toEqual([]);
    expect(body.availability).toBe("exhausted");
    expect(body.eligibleCount).toBe(0);
    expect(body.baseCount).toBe(2);
    expect(body.bridgeFavour?.id).toBe("route-bridge");
    expect(body.bridgeFavour?.rewardType).toBe("points");
  });

  it("returns empty with baseCount 1 (floor) without claiming zero proofs in counts", async () => {
    const only = doneTask();
    tasksFixture = [only];
    const res = await GET(
      new Request(`http://localhost/api/jury?address=${JUDGE}`) as any
    );
    const body = await res.json();
    expect(body.availability).toBe("empty");
    expect(body.baseCount).toBe(1);
    expect(body.cards).toEqual([]);
  });
});

describe("POST /api/jury still refuses appeal grading", () => {
  it("rejects unknown / missing card without awarding", async () => {
    const res = await POST(
      new Request("http://localhost/api/jury", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: JUDGE, cardId: "missing", verdict: "match" }),
      }) as any
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
