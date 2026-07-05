import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Task } from "@/lib/types";
import type { PayoutResult } from "@/lib/campaign-unlock";

// In-memory Redis: enough surface for campaign-unlock (get/set/incr/decr/sadd/srem/smembers/del).
const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    incr: async (key: string) => {
      const next = Number(mockStore.get(key) || 0) + 1;
      mockStore.set(key, next);
      return next;
    },
    decr: async (key: string) => {
      const next = Number(mockStore.get(key) || 0) - 1;
      mockStore.set(key, next);
      return next;
    },
    del: async (key: string) => { mockStore.delete(key); return 1; },
    sadd: async (key: string, member: string) => {
      const s = mockSets.get(key) || new Set<string>();
      const added = s.has(member) ? 0 : 1;
      s.add(member); mockSets.set(key, s); return added;
    },
    srem: async (key: string, member: string) => {
      mockSets.get(key)?.delete(member); return 1;
    },
    smembers: async (key: string) => [...(mockSets.get(key) || [])],
    scard: async (key: string) => (mockSets.get(key) || new Set()).size,
  }),
}));

// Escrow module is only used for the DEFAULT payout sender; tests always inject
// a fake sender, so stub it out to keep chain code out of the test path.
vi.mock("@/lib/escrow", () => ({
  getPayoutClients: () => null,
  USDC_ADDRESS: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
}));

import { recordCampaignCompletion, tryUnlockPayout, retryPendingUnlocks, getUnlockProgress } from "@/lib/campaign-unlock";
import { getCampaign } from "@/lib/campaigns";

const CAMPAIGN_ID = "say-it-out-loud";
const UNLOCK = getCampaign(CAMPAIGN_ID)!.unlock!;
const WALLET = "0x" + "a".repeat(40);

let seq = 0;
function cleanTask(overrides: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `t${seq}`,
    poster: "agent:relay",
    claimant: WALLET,
    category: "social",
    campaignId: CAMPAIGN_ID,
    description: `post ${seq}`,
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 10,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "completed",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: { verdict: "pass", reasoning: "ok", confidence: 0.95 },
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
    claimantVerification: "orb",
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1000,
    completionCount: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

function okSender() {
  const calls: Array<{ to: string; amount: number }> = [];
  const sender = async (to: `0x${string}`, amount: number): Promise<PayoutResult> => {
    calls.push({ to, amount });
    return { hash: `0xtx${calls.length}`, success: true };
  };
  return { sender, calls };
}

beforeEach(() => {
  mockStore.clear();
  mockSets.clear();
});

describe("clean gate", () => {
  it("non-Orb completions never count", async () => {
    const { sender, calls } = okSender();
    for (const level of ["device", "wallet", null] as const) {
      const r = await recordCampaignCompletion(cleanTask({ claimantVerification: level }), sender);
      expect(r.counted).toBe(false);
    }
    expect(calls.length).toBe(0);
    const p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.progress).toBe(0);
  });

  it("flagged verdicts never count", async () => {
    const { sender } = okSender();
    const r = await recordCampaignCompletion(
      cleanTask({ verificationResult: { verdict: "flag", reasoning: "sus", confidence: 0.7 } }),
      sender
    );
    expect(r.counted).toBe(false);
  });

  it("non-campaign and non-wallet claimants never count", async () => {
    const { sender } = okSender();
    expect((await recordCampaignCompletion(cleanTask({ campaignId: undefined }), sender)).counted).toBe(false);
    expect((await recordCampaignCompletion(cleanTask({ claimant: "dev_alice" }), sender)).counted).toBe(false);
  });
});

describe("threshold unlock", () => {
  it("pays exactly once at the threshold, and is idempotent after", async () => {
    const { sender, calls } = okSender();
    let unlockTx: string | null = null;
    for (let i = 0; i < UNLOCK.unlockThreshold; i++) {
      const r = await recordCampaignCompletion(cleanTask(), sender);
      unlockTx = r.unlockTx ?? unlockTx;
    }
    expect(unlockTx).toBe("0xtx1");
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ to: WALLET, amount: UNLOCK.unlockAmount });

    // Further completions (capped) or direct retries never pay again.
    const again = await tryUnlockPayout(CAMPAIGN_ID, WALLET, sender);
    expect(again).toBe("0xtx1");
    expect(calls.length).toBe(1);
  });

  it("repeating the SAME task never advances progress (distinct tasks required)", async () => {
    const { sender, calls } = okSender();
    const sameTask = cleanTask();
    for (let i = 0; i < UNLOCK.unlockThreshold + 2; i++) {
      await recordCampaignCompletion(sameTask, sender);
    }
    const p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.progress).toBe(1);
    expect(p!.paid).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("progress caps at maxCountedPerUser", async () => {
    const { sender } = okSender();
    for (let i = 0; i < UNLOCK.maxCountedPerUser + 3; i++) {
      await recordCampaignCompletion(cleanTask(), sender);
    }
    const p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.progress).toBe(UNLOCK.maxCountedPerUser);
  });
});

describe("pot cap", () => {
  it("never pays past the pot", async () => {
    const { sender, calls } = okSender();
    const maxUnlocks = Math.floor(UNLOCK.pot / UNLOCK.unlockAmount);
    for (let u = 0; u < maxUnlocks + 2; u++) {
      const wallet = ("0x" + String(u).padStart(40, "0")) as string;
      for (let i = 0; i < UNLOCK.unlockThreshold; i++) {
        await recordCampaignCompletion(cleanTask({ claimant: wallet }), sender);
      }
    }
    expect(calls.length).toBe(maxUnlocks);
    expect(calls.reduce((s, c) => s + c.amount, 0)).toBeLessThanOrEqual(UNLOCK.pot);
  });
});

describe("failure handling", () => {
  it("a failed send lands in the retry set and the cron settles it without double-reserving", async () => {
    let fail = true;
    const calls: string[] = [];
    const flaky = async (to: `0x${string}`): Promise<PayoutResult | null> => {
      if (fail) return null;
      calls.push(to);
      return { hash: "0xretry", success: true };
    };
    for (let i = 0; i < UNLOCK.unlockThreshold; i++) {
      await recordCampaignCompletion(cleanTask(), flaky);
    }
    let p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.paid).toBe(false);

    fail = false;
    const result = await retryPendingUnlocks(flaky);
    expect(result.settled).toBe(1);
    p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.paid).toBe(true);
    expect(p!.payTx).toBe("0xretry");
    // The reservation from the failed attempt was reused, not doubled.
    expect(Number(mockStore.get(`unlock:${CAMPAIGN_ID}:paidCount`))).toBe(1);
  });

  it("a reverted transfer is retried and never reported paid", async () => {
    let revert = true;
    let n = 0;
    const sender = async (): Promise<PayoutResult> => {
      n++;
      return { hash: `0xrv${n}`, success: !revert };
    };
    for (let i = 0; i < UNLOCK.unlockThreshold; i++) {
      await recordCampaignCompletion(cleanTask(), sender);
    }
    let p = await getUnlockProgress(CAMPAIGN_ID, WALLET);
    expect(p!.paid).toBe(false);
    expect(p!.payTx).toBe(null); // unpaid tx hash is never surfaced as a payout

    revert = false;
    // The state has a recorded (reverted) payTx; the on-chain resolver is
    // unavailable in tests (escrow mocked to null → "unknown"), which must BACK
    // OFF rather than re-send — that is the double-pay-safe behavior.
    const retry = await tryUnlockPayout(CAMPAIGN_ID, WALLET, sender);
    expect(retry).toBe(null);
    expect((mockSets.get("unlock:retry") || new Set()).size).toBe(1);
  });
});
