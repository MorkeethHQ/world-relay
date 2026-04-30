import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTask, getTask, listTasks, claimTask, submitProof, completeTask } from "@/lib/store";

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
      mockSets.get(key)!.add(member);
    },
    smembers: async (key: string) => Array.from(mockSets.get(key) || []),
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
