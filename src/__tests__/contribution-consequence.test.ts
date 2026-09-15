import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildConsequence,
  creditPtsForPass,
  hasCompletedClaimant,
  listContributionConsequences,
  naiveBridgeEligibleIds,
  recordCompletedClaimant,
  recordContributionConsequence,
} from "@/lib/contribution-consequence";
import { isJuryBridgeEligible, isJuryBridgeClaimOfferable, pickJuryBridgeFavour } from "@/lib/jury";
import { claimTask, completeTask, createTask, getTask, submitProof } from "@/lib/store";
import type { Task } from "@/lib/types";

const mockStore = new Map<string, string>();
const mockSets = new Map<string, Set<string>>();
const mockLists = new Map<string, string[]>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (key: string, value: string, opts?: { nx?: boolean; px?: number }) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    get: async (key: string) => mockStore.get(key) || null,
    del: async (key: string) => {
      mockStore.delete(key);
    },
    sadd: async (key: string, member: string) => {
      if (!mockSets.has(key)) mockSets.set(key, new Set());
      const s = mockSets.get(key)!;
      const added = s.has(member) ? 0 : 1;
      s.add(member);
      return added;
    },
    smembers: async (key: string) => Array.from(mockSets.get(key) || []),
    sismember: async (key: string, member: string) => (mockSets.get(key)?.has(member) ? 1 : 0),
    srem: async (key: string, member: string) => {
      mockSets.get(key)?.delete(member);
    },
    lpush: async (key: string, value: string) => {
      const list = mockLists.get(key) || [];
      list.unshift(value);
      mockLists.set(key, list);
      return list.length;
    },
    ltrim: async (key: string, start: number, stop: number) => {
      const list = mockLists.get(key) || [];
      mockLists.set(key, list.slice(start, stop + 1));
      return "OK";
    },
    lrange: async (key: string, start: number, stop: number) => {
      const list = mockLists.get(key) || [];
      const end = stop < 0 ? list.length : stop + 1;
      return list.slice(start, end);
    },
    pipeline: () => {
      const ops: Array<() => unknown> = [];
      return {
        get: (key: string) => {
          ops.push(() => mockStore.get(key) || null);
        },
        exec: async () => ops.map((op) => op()),
      };
    },
    pexpire: async () => {},
    incr: async () => 1,
  }),
}));

vi.mock("@/lib/seed-caps", () => ({
  checkSeedCap: async () => ({ allowed: true }),
  recordSeededEarn: async () => {},
}));

const JUDGE = "0x" + "1".repeat(40);
const POSTER = "0x" + "a".repeat(40);

beforeEach(() => {
  mockStore.clear();
  mockSets.clear();
  mockLists.clear();
});

function openBridgeShape(over: Partial<Task> = {}): Task {
  return {
    id: "bridge-reopen",
    poster: POSTER,
    claimant: null,
    category: "feedback",
    description: "Share one honest take",
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 12,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
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
    claimantVerification: null,
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 3,
    completionCount: 1,
    createdAt: new Date().toISOString(),
    ...over,
  } as Task;
}

describe("creditPtsForPass / buildConsequence", () => {
  it("derives points credit from the favour bounty, not a carried constant", () => {
    const task = openBridgeShape({ bountyUsdc: 17 });
    expect(creditPtsForPass(task)).toBe(17);
    const c = buildConsequence({
      task: { ...task, proofNote: "because the light was wrong", proofImageUrl: null },
      verdict: "pass",
      reasoning: "ok",
      fromBridge: true,
    });
    expect(c.creditPts).toBe(17);
    expect(c.creditKind).toBe("points");
    expect(c.nextAction.kind).toBe("jury");
    expect(c.evidence.note).toMatch(/light/);
  });

  it("flag is pending credit with honest next action", () => {
    const c = buildConsequence({
      task: openBridgeShape(),
      verdict: "flag",
      reasoning: "unsure",
      fromBridge: false,
    });
    expect(c.creditPts).toBe(0);
    expect(c.creditKind).toBe("pending");
    expect(c.nextAction.kind).toBe("none");
  });
});

describe("durable prior-completion after reopen", () => {
  it("records completed_claimants on pass and refuses re-claim after multi-completion reopen", async () => {
    const task = await createTask({
      poster: POSTER,
      description: "Rate this honestly",
      location: "Anywhere",
      bountyUsdc: 10,
      deadlineHours: 24,
      category: "feedback",
      rewardType: "points",
      maxCompletions: 3,
    });
    const claimed = await claimTask(task.id, JUDGE, "wallet");
    expect(claimed?.status).toBe("claimed");
    await submitProof(task.id, null, "honest take");
    const done = await completeTask(task.id, {
      verdict: "pass",
      reasoning: "genuine",
      confidence: 0.9,
    });
    // Reopened for more completions — row no longer shows this claimant.
    expect(done?.status).toBe("open");
    expect(done?.claimant).toBeNull();
    expect(await hasCompletedClaimant(task.id, JUDGE)).toBe(true);

    const again = await claimTask(task.id, JUDGE, "wallet");
    expect(again).toBeNull();

    const other = "0x" + "2".repeat(40);
    const otherClaim = await claimTask(task.id, other, "wallet");
    expect(otherClaim?.claimant).toBe(other);
  });

  it("bridge offer excludes previously completed reopen; naive baseline still offers it", async () => {
    const favour = openBridgeShape({ id: "reopen-bridge-1" });
    await recordCompletedClaimant(favour.id, JUDGE);

    // Shape gate alone still says yes (naive two-hour arm).
    expect(isJuryBridgeEligible(favour, JUDGE, [favour])).toBe(true);
    const naive = naiveBridgeEligibleIds([favour], JUDGE, isJuryBridgeEligible);
    expect(naive).toContain(favour.id);

    // Offer-time parity with claim refuses it.
    expect(await isJuryBridgeClaimOfferable(favour, JUDGE, [favour])).toBe(false);
    expect(await pickJuryBridgeFavour([favour], JUDGE)).toBeNull();
  });

  it("naive arm loses to exclusion on a reopen corpus (embarrassing baseline)", async () => {
    const corpus: Task[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `corp-${i}`;
      corpus.push(openBridgeShape({ id, bountyUsdc: 10 + i }));
      await recordCompletedClaimant(id, JUDGE);
    }
    const naive = naiveBridgeEligibleIds(corpus, JUDGE, isJuryBridgeEligible);
    const excluded: string[] = [];
    for (const t of corpus) {
      if (await isJuryBridgeClaimOfferable(t, JUDGE, corpus)) excluded.push(t.id);
    }
    // Naive re-offers every completed reopen; exclusion offers none.
    expect(naive.length).toBe(5);
    expect(excluded.length).toBe(0);
    // The finding: naive is worse (would re-offer completed work).
    expect(naive.length).toBeGreaterThan(excluded.length);
  });
});

describe("contribution ledger survives reopen", () => {
  it("listContributionConsequences returns recorded chain rows", async () => {
    const task = openBridgeShape({ id: "ledger-1", proofNote: "saw it myself" });
    const c = buildConsequence({
      task,
      verdict: "pass",
      reasoning: "pass",
      fromBridge: true,
      creditPts: creditPtsForPass(task),
    });
    await recordContributionConsequence(JUDGE, c);
    const list = await listContributionConsequences(JUDGE);
    expect(list).toHaveLength(1);
    expect(list[0]!.taskId).toBe("ledger-1");
    expect(list[0]!.creditPts).toBe(12);
    expect(list[0]!.nextAction.kind).toBe("jury");
  });
});

describe("store reopen still leaves task open for others", () => {
  it("getTask after pass+reopen has no claimant but completionCount advanced", async () => {
    const task = await createTask({
      poster: POSTER,
      description: "multi",
      location: "Anywhere",
      bountyUsdc: 5,
      deadlineHours: 12,
      category: "review",
      rewardType: "points",
      maxCompletions: 2,
    });
    await claimTask(task.id, JUDGE);
    await submitProof(task.id, null, "note");
    await completeTask(task.id, { verdict: "pass", reasoning: "ok", confidence: 0.8 });
    const reopened = await getTask(task.id);
    expect(reopened?.status).toBe("open");
    expect(reopened?.completionCount).toBe(1);
    expect(reopened?.claimant).toBeNull();
  });
});
