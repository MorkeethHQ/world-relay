import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTask, getTask, listTasks, claimTask, submitProof, completeTask, setFollowUp, resolveFollowUp, posterConfirm } from "@/lib/store";

// Mock Redis with an in-memory implementation for tests
const mockStore = new Map<string, string>();
const mockSets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (key: string, value: string, opts?: any) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    get: async (key: string) => mockStore.get(key) || null,
    del: async (key: string) => { mockStore.delete(key); },
    sadd: async (key: string, member: string) => {
      if (!mockSets.has(key)) mockSets.set(key, new Set());
      const had = mockSets.get(key)!.has(member);
      mockSets.get(key)!.add(member);
      return had ? 0 : 1;
    },
    smembers: async (key: string) => Array.from(mockSets.get(key) || []),
    sismember: async (key: string, member: string) => (mockSets.get(key)?.has(member) ? 1 : 0),
    srem: async (key: string, member: string) => { mockSets.get(key)?.delete(member); },
    pipeline: () => {
      const ops: Array<() => any> = [];
      return {
        get: (key: string) => { ops.push(() => mockStore.get(key) || null); },
        exec: async () => ops.map(op => op()),
      };
    },
    pexpire: async () => {},
    incr: async () => 1,
  }),
}));

beforeEach(() => {
  mockStore.clear();
  mockSets.clear();
});

describe("createTask", () => {
  it("creates a task with correct defaults", async () => {
    const task = await createTask({
      poster: "agent:shelfwatch",
      description: "Check if Blue Bottle is open",
      location: "Paris, Le Marais",
      bountyUsdc: 5,
      deadlineHours: 24,
    });

    expect(task.id).toBeDefined();
    expect(task.poster).toBe("agent:shelfwatch");
    expect(task.description).toBe("Check if Blue Bottle is open");
    expect(task.status).toBe("open");
    expect(task.claimant).toBeNull();
    expect(task.bountyUsdc).toBe(5);
    expect(task.category).toBe("custom");
    expect(task.taskType).toBe("standard");
    expect(task.proofImageUrl).toBeNull();
    expect(task.verificationResult).toBeNull();
  });

  it("sets deadline correctly", async () => {
    const before = Date.now();
    const task = await createTask({
      poster: "test",
      description: "test",
      location: "test",
      bountyUsdc: 1,
      deadlineHours: 2,
    });
    const after = Date.now();

    const deadline = new Date(task.deadline).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 2 * 3600_000);
    expect(deadline).toBeLessThanOrEqual(after + 2 * 3600_000);
  });

  it("resolves agent from agentId", async () => {
    const task = await createTask({
      poster: "agent:shelfwatch",
      description: "test",
      location: "test",
      bountyUsdc: 1,
      deadlineHours: 1,
      agentId: "shelfwatch",
    });

    expect(task.agent).not.toBeNull();
    expect(task.agent!.name).toBe("ShelfWatch");
    expect(task.agent!.icon).toBe("🏷️");
  });

  it("sets escrow fields when provided", async () => {
    const task = await createTask({
      poster: "agent:test",
      description: "funded task",
      location: "test",
      bountyUsdc: 5,
      deadlineHours: 24,
      onChainId: 23,
      escrowTxHash: "0xabc123",
    });

    expect(task.onChainId).toBe(23);
    expect(task.escrowTxHash).toBe("0xabc123");
  });
});

describe("getTask", () => {
  it("returns created task by id", async () => {
    const created = await createTask({
      poster: "test",
      description: "findme",
      location: "test",
      bountyUsdc: 1,
      deadlineHours: 1,
    });

    const found = await getTask(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.description).toBe("findme");
  });

  it("returns undefined for unknown id", async () => {
    const found = await getTask("nonexistent-id");
    expect(found).toBeUndefined();
  });
});

describe("listTasks", () => {
  it("returns all created tasks", async () => {
    await createTask({ poster: "a", description: "first", location: "x", bountyUsdc: 1, deadlineHours: 1 });
    await createTask({ poster: "b", description: "second", location: "x", bountyUsdc: 1, deadlineHours: 1 });
    await createTask({ poster: "c", description: "third", location: "x", bountyUsdc: 1, deadlineHours: 1 });

    const tasks = await listTasks();
    expect(tasks.length).toBe(3);
    const descriptions = tasks.map(t => t.description);
    expect(descriptions).toContain("first");
    expect(descriptions).toContain("second");
    expect(descriptions).toContain("third");
  });
});

describe("claimTask", () => {
  it("claims an open task", async () => {
    const task = await createTask({
      poster: "poster1",
      description: "claimable",
      location: "test",
      bountyUsdc: 5,
      deadlineHours: 1,
    });

    const claimed = await claimTask(task.id, "runner1", "wallet");
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.claimant).toBe("runner1");
    expect(claimed!.claimantVerification).toBe("wallet");
  });

  it("prevents self-claim", async () => {
    const task = await createTask({
      poster: "poster1",
      description: "self-claim",
      location: "test",
      bountyUsdc: 1,
      deadlineHours: 1,
    });

    const result = await claimTask(task.id, "poster1");
    expect(result).toBeNull();
  });

  it("prevents double-claim", async () => {
    const task = await createTask({
      poster: "poster1",
      description: "double",
      location: "test",
      bountyUsdc: 1,
      deadlineHours: 1,
    });

    await claimTask(task.id, "runner1");
    const second = await claimTask(task.id, "runner2");
    expect(second).toBeNull();
  });
});

describe("submitProof", () => {
  it("attaches proof to claimed task", async () => {
    const task = await createTask({
      poster: "p",
      description: "proof test",
      location: "x",
      bountyUsdc: 1,
      deadlineHours: 1,
    });
    await claimTask(task.id, "runner");

    const result = await submitProof(task.id, "https://img.example.com/proof.jpg", "It's open");
    expect(result).not.toBeNull();
    expect(result!.proofImageUrl).toBe("https://img.example.com/proof.jpg");
    expect(result!.proofNote).toBe("It's open");
    expect(result!.proofImages).toEqual(["https://img.example.com/proof.jpg"]);
  });

  it("rejects proof on unclaimed task", async () => {
    const task = await createTask({
      poster: "p",
      description: "not claimed",
      location: "x",
      bountyUsdc: 1,
      deadlineHours: 1,
    });

    const result = await submitProof(task.id, "url", "note");
    expect(result).toBeNull();
  });
});

describe("completeTask", () => {
  it("completes task with pass verdict", async () => {
    const task = await createTask({
      poster: "p",
      description: "complete me",
      location: "x",
      bountyUsdc: 5,
      deadlineHours: 1,
    });
    await claimTask(task.id, "runner");
    await submitProof(task.id, "url", "note");

    const result = await completeTask(task.id, {
      verdict: "pass",
      reasoning: "Photo matches description",
      confidence: 0.92,
    });

    expect(result!.status).toBe("completed");
    expect(result!.verificationResult!.verdict).toBe("pass");
    expect(result!.verificationResult!.confidence).toBe(0.92);
  });

  it("resets task on fail verdict", async () => {
    const task = await createTask({
      poster: "p",
      description: "fail me",
      location: "x",
      bountyUsdc: 1,
      deadlineHours: 1,
    });
    await claimTask(task.id, "runner");
    await submitProof(task.id, "url", "bad proof");

    const result = await completeTask(task.id, {
      verdict: "fail",
      reasoning: "Photo doesn't match",
      confidence: 0.3,
    });

    expect(result!.status).toBe("open");
    expect(result!.claimant).toBeNull();
    expect(result!.proofImageUrl).toBeNull();
  });
});

// 2026-10-04. LOCAL DOUBLE: the in-memory Redis above, not the live store.
// Live evidence for the bug: task 3580445b ("Say It Out Loud", 25 of 500 replies)
// sits at status completed with a resolved follow-up, so one late pass closed a
// 500 reply favour for good. The welcome campaign has 4 follow-ups pending on
// 1000 reply favours.
describe("a late pass on a multi-reply favour counts one reply and reopens it", () => {
  async function flaggedMulti(maxCompletions: number) {
    const task = await createTask({
      poster: "agent:relay",
      description: "Photo your first drink of the day and tell us your city",
      location: "Anywhere",
      bountyUsdc: 5,
      deadlineHours: 24,
      rewardType: "points",
      maxCompletions,
      campaignId: "first-favour",
    } as Parameters<typeof createTask>[0]);
    await claimTask(task.id, "0xRunner");
    await submitProof(task.id, "url", "note");
    await completeTask(task.id, { verdict: "flag", reasoning: "needs a closer look", confidence: 0.7 });
    return task.id;
  }

  it("follow-up pass: the favour goes back to open with one more reply counted", async () => {
    const id = await flaggedMulti(1000);
    await setFollowUp(id, "Which city is this?", 0.7);
    const out = await resolveFollowUp(id, { verdict: "pass", reasoning: "answered", confidence: 0.9 });
    expect(out!.status).toBe("open");
    expect(out!.completionCount).toBe(1);
    expect(out!.claimant).toBeNull();
    expect(out!.proofImageUrl).toBeNull();
    expect(out!.aiFollowUp).toBeNull();
    // The same person cannot pass it twice: the per-person slot is taken.
    expect(mockSets.get(`completed_claimants:${id}`)?.has("0xrunner")).toBe(true);
  });

  it("poster approval: same rule", async () => {
    const id = await flaggedMulti(100);
    const out = await posterConfirm(id, true);
    expect(out!.status).toBe("open");
    expect(out!.completionCount).toBe(1);
    expect(out!.claimant).toBeNull();
    expect(mockSets.get(`completed_claimants:${id}`)?.has("0xrunner")).toBe(true);
  });

  it("the last reply slot still completes the favour", async () => {
    const id = await flaggedMulti(1);
    const out = await posterConfirm(id, true);
    expect(out!.status).toBe("completed");
    expect(out!.claimant).toBe("0xRunner");
  });

  it("a multi-reply favour completes when its final slot is used", async () => {
    const task = await createTask({ poster: "agent:relay", description: "two replies wanted here", location: "Anywhere", bountyUsdc: 5, deadlineHours: 24, rewardType: "points", maxCompletions: 2 } as Parameters<typeof createTask>[0]);
    await claimTask(task.id, "0xA");
    await submitProof(task.id, "url", "note");
    await completeTask(task.id, { verdict: "pass", reasoning: "ok", confidence: 0.9 });
    await claimTask(task.id, "0xB");
    await submitProof(task.id, "url", "note");
    await completeTask(task.id, { verdict: "flag", reasoning: "look", confidence: 0.7 });
    const out = await posterConfirm(task.id, true);
    expect(out!.status).toBe("completed");
    expect(out!.completionCount).toBe(2);
  });
});

// 2026-10-05, finding B of the 01:00 review. LOCAL DOUBLE: the in-memory Redis above.
// POST /api/tasks refuses a money favour with more than one reply, and that was
// the only thing keeping the reopen path away from money. The store now enforces
// it too: one escrow funds one payout, whatever maxCompletions says.
describe("a money favour is a single payout on every pass path, whatever maxCompletions says", () => {
  const MONEY: Array<[string, Record<string, unknown>]> = [
    ["legacy usdc with an on-chain escrow", { rewardType: "usdc", onChainId: 41, escrowTxHash: `0x${"a".repeat(64)}` }],
    ["usdc-v2, funded", { rewardType: "usdc-v2", escrowTxHash: `0x${"b".repeat(64)}` }],
    ["usdc-v2, not funded yet", { rewardType: "usdc-v2" }],
    ["a points label on a record that carries an escrow id", { rewardType: "points", onChainId: 42 }],
    ["a points label on a record that carries an escrow hash", { rewardType: "points", escrowTxHash: "0xabc" }],
    ["double or nothing", { rewardType: "points", taskType: "double-or-nothing", donOnChainId: 7 }],
  ];

  // Built through the real store calls, then given its money fields directly in
  // the double: the public routes would refuse to create this record at all.
  async function flaggedMoney(fields: Record<string, unknown>, verdict: "flag" | null = "flag") {
    const t = await createTask({ poster: "0xPoster", description: "Deliver the parcel to the front desk", location: "Paris", bountyUsdc: 5, deadlineHours: 24, rewardType: "points", maxCompletions: 5 } as Parameters<typeof createTask>[0]);
    await claimTask(t.id, "0xRunner");
    await submitProof(t.id, "https://blob.example/p.jpg", "left at the desk");
    if (verdict) await completeTask(t.id, { verdict: "flag", reasoning: "needs a closer look", confidence: 0.7 });
    const raw = JSON.parse(mockStore.get(`task:${t.id}`)!);
    mockStore.set(`task:${t.id}`, JSON.stringify({ ...raw, ...fields }));
    return t.id;
  }
  const held = (t: Awaited<ReturnType<typeof getTask>>) => {
    expect(t!.status).toBe("completed");
    expect(t!.claimant).toBe("0xRunner");
    expect(t!.proofImageUrl).toBe("https://blob.example/p.jpg");
    expect(t!.proofNote).toBe("left at the desk");
  };

  it.each(MONEY)("follow-up pass, %s: completed once, never reopened, the proof and the claimant stay", async (_n, fields) => {
    const id = await flaggedMoney(fields);
    await setFollowUp(id, "Who signed for it?", 0.7);
    await resolveFollowUp(id, { verdict: "pass", reasoning: "signed", confidence: 0.9 });
    held(await getTask(id));
    expect(mockSets.get(`completed_claimants:${id}`)).toBeUndefined();
  });

  it.each(MONEY)("poster or dispute approval, %s: completed once, never reopened", async (_n, fields) => {
    const id = await flaggedMoney(fields);
    await posterConfirm(id, true);
    held(await getTask(id));
    // And it cannot be approved a second time.
    expect(await posterConfirm(id, true)).toBeNull();
  });

  it.each(MONEY)("first pass (completeTask), %s: completed once, never reopened", async (_n, fields) => {
    const id = await flaggedMoney(fields, null);
    await completeTask(id, { verdict: "pass", reasoning: "ok", confidence: 0.95 });
    held(await getTask(id));
  });

  it("a plain points favour with several replies still reopens on all three paths", async () => {
    const a = await flaggedMoney({});
    await posterConfirm(a, true);
    expect((await getTask(a))!.status).toBe("open");
    const b = await flaggedMoney({});
    await setFollowUp(b, "q", 0.7);
    await resolveFollowUp(b, { verdict: "pass", reasoning: "ok", confidence: 0.9 });
    expect((await getTask(b))!.status).toBe("open");
    const c = await flaggedMoney({}, null);
    await completeTask(c, { verdict: "pass", reasoning: "ok", confidence: 0.9 });
    expect((await getTask(c))!.status).toBe("open");
  });
});

describe("a follow-up verdict applies only to a favour that is still claimed", () => {
  it.each(["expired", "cancelled", "completed", "open"] as const)("a %s favour with a follow-up still pending is left exactly as it is", async (status) => {
    const t = await createTask({ poster: "agent:relay", description: "Photo your first drink of the day", location: "Anywhere", bountyUsdc: 5, deadlineHours: 24, rewardType: "points", maxCompletions: 1000 } as Parameters<typeof createTask>[0]);
    await claimTask(t.id, "0xRunner");
    await submitProof(t.id, "url", "note");
    await completeTask(t.id, { verdict: "flag", reasoning: "look", confidence: 0.7 });
    await setFollowUp(t.id, "Which city?", 0.7);
    // What the expiry cron or a cancel leaves behind: the status moves, the follow-up stays pending.
    const raw = JSON.parse(mockStore.get(`task:${t.id}`)!);
    mockStore.set(`task:${t.id}`, JSON.stringify({ ...raw, status }));
    const before = mockStore.get(`task:${t.id}`);
    expect(await resolveFollowUp(t.id, { verdict: "pass", reasoning: "ok", confidence: 0.9 })).toBeNull();
    expect(mockStore.get(`task:${t.id}`)).toBe(before);
  });
});
