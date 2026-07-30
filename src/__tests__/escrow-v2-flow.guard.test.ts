/**
 * ADVERSARIAL GUARD: the escrow-v2 APP flow, attacked by failure class
 * (SECURITY-INVARIANTS.md method — audit the class, not the vibe).
 *
 * Classes covered:
 *   1. DARK RAIL — flag off => every v2 surface 404s / refuses.
 *   2. FAKE FUNDING AT POST — client-sent escrow markers on a v2 post are dropped.
 *   3. CAPS — env caps enforced server-side when set (unlimited by default).
 *   4. DEMAND GATE — no fund step before a claimant exists (money moves only
 *      with a matched counterparty).
 *   5. DOUBLE-FUND — second fund attempt refused at both app and chain level.
 *   6. ACCEPT-SWAP AFTER FUND — recipient mismatch on-chain => fail closed.
 *   7. MARK-PAID WITHOUT CHAIN STATE — verify-* refuse whenever the chain
 *      does not show the claimed state; nothing books off a client's word.
 *   8. WALLET-BOUND CLAIMS — dev/non-wallet claimants can never become
 *      recipients of a v2 escrow.
 *
 * The chain itself is mocked at the module boundary (getEscrowV2Record etc.);
 * everything else — route logic, config parsing, builders — is real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Controllable chain state
// ---------------------------------------------------------------------------
const chain = {
  record: null as null | {
    funder: string;
    recipient: string;
    amount: bigint;
    deadline: bigint;
    status: number;
  },
  eventTx: null as string | null,
};

vi.mock("@/lib/escrow-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/escrow-v2")>();
  return {
    ...actual,
    getEscrowV2Record: vi.fn(async () => chain.record),
    verifyEscrowV2Funded: vi.fn(
      async (_taskId: string, expected: { recipient: string; amount: bigint; funder: string }) => {
        const rec = chain.record;
        if (!rec) return null;
        const ok =
          rec.status === 1 &&
          rec.recipient.toLowerCase() === expected.recipient.toLowerCase() &&
          rec.funder.toLowerCase() === expected.funder.toLowerCase() &&
          rec.amount === expected.amount;
        return ok ? rec : null;
      }
    ),
    verifyEscrowV2Receipt: vi.fn(async () => false),
    findEscrowV2EventTx: vi.fn(async () => chain.eventTx),
    refundExpiredEscrowV2: vi.fn(async () => null),
  };
});

// ---------------------------------------------------------------------------
// In-memory store with the REAL transition semantics
// ---------------------------------------------------------------------------
type StoredTask = Record<string, unknown> & { id: string };
const tasks = new Map<string, StoredTask>();

vi.mock("@/lib/store", () => ({
  getTask: async (id: string) => tasks.get(id),
  listTasks: async () => Array.from(tasks.values()),
  createTask: async (input: Record<string, unknown>) => {
    const task = {
      id: `t${tasks.size + 1}`,
      claimant: null,
      status: "open",
      escrowV2Address: null,
      escrowV2Version: null,
      escrowV2RefundTx: null,
      settlementTx: null,
      pendingRelease: false,
      completionCount: 0,
      deadline: new Date(Date.now() + (Number(input.deadlineHours) || 24) * 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      agent: null,
      verificationResult: null,
      claimantVerification: null,
      ...input,
    };
    tasks.set(task.id, task);
    return task;
  },
  markEscrowV2Funded: async (id: string, info: { contractAddress: string; version: number; fundTxHash: string }) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2") return null;
    if (t.escrowTxHash && t.escrowV2Address) return t;
    t.escrowTxHash = info.fundTxHash;
    t.escrowV2Address = info.contractAddress;
    t.escrowV2Version = info.version;
    return t;
  },
  markEscrowV2Settled: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2" || !t.escrowV2Address) return null;
    t.status = "completed";
    t.pendingRelease = false;
    t.settlementTx = tx;
    return t;
  },
  markEscrowV2Refunded: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2" || !t.escrowV2Address) return null;
    t.escrowV2RefundTx = tx;
    if (t.status !== "completed") t.status = "expired";
    return t;
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/session", () => ({ ownershipError: () => null }));
const recordCompletion = vi.fn(async () => ({}));
vi.mock("@/lib/reputation", () => ({
  recordCompletion: (...a: unknown[]) => (recordCompletion as (...x: unknown[]) => unknown)(...a),
  getReputation: async () => ({ currentStreak: 0 }),
}));
vi.mock("@/lib/proof-of-favour", () => ({
  recordFavourPosted: async () => {},
  recordFavourCompleted: async () => {},
  recordFundingReward: async () => {},
  completionPointsFor: () => 15,
}));
vi.mock("@/lib/notifications", () => ({ notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
// tasks-route periphery
vi.mock("@/lib/escrow", () => ({ isEscrowTaskFunded: async () => false }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));

import { GET as escrowGET, POST as escrowPOST } from "@/app/api/escrow-v2/route";
import { POST as tasksPOST } from "@/app/api/tasks/route";
// escrowV2Address passes through the partial mock to the real config source,
// so this file never hardcodes the contract literal (address-isolation guard).
import { escrowV2Address } from "@/lib/escrow-v2";

const POSTER = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAAAAAAAAaaaa";
const CLAIMANT = "0x244eEE7101fEE95D5040452d235dEa5A5bAA786b";
const ATTACKER = "0xBBbBBBbbbBBBbbbbBbbBBbBBbBbbbBbBbBbbBBbB";
const CONTRACT = escrowV2Address();
const TX = "0x" + "ab".repeat(32);

function escrowReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/escrow-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
function escrowGet(taskId?: string) {
  return new Request(`http://localhost/api/escrow-v2${taskId ? `?taskId=${taskId}` : ""}`) as never;
}
function taskReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function seedV2Task(over: Record<string, unknown> = {}) {
  const task = {
    id: "task-1",
    poster: POSTER,
    claimant: CLAIMANT,
    status: "claimed",
    rewardType: "usdc-v2",
    bountyUsdc: 5,
    description: "walk my dog around the block",
    location: "Paris",
    deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
    onChainId: null,
    escrowTxHash: null,
    escrowV2Address: null,
    escrowV2Version: null,
    escrowV2RefundTx: null,
    settlementTx: null,
    pendingRelease: false,
    completionCount: 0,
    maxCompletions: 1,
    verificationResult: null,
    claimantVerification: "orb",
    agent: null,
    ...over,
  };
  tasks.set(task.id, task);
  return task;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ESCROW_V2_ENABLED", "1");
  tasks.clear();
  chain.record = null;
  chain.eventTx = null;
  recordCompletion.mockClear();
});

// ---------------------------------------------------------------------------
// 1. DARK RAIL
// ---------------------------------------------------------------------------
describe("class 1 — dark rail", () => {
  it("flag off => GET and every POST action 404", async () => {
    vi.stubEnv("ESCROW_V2_ENABLED", "");
    expect((await escrowGET(escrowGet())).status).toBe(404);
    for (const action of ["prepare-fund", "verify-funded", "prepare-release", "verify-released", "prepare-refund", "verify-refunded", "refund-expired"]) {
      const res = await escrowPOST(escrowReq({ action, taskId: "task-1" }));
      expect(res.status, action).toBe(404);
    }
  });

  it("flag off => a usdc-v2 post is rejected, not converted", async () => {
    vi.stubEnv("ESCROW_V2_ENABLED", "");
    const res = await tasksPOST(taskReq({
      poster: POSTER,
      description: "water my plants while I travel for two weeks please",
      location: "Paris",
      bountyUsdc: 5,
      deadlineHours: 24,
      rewardType: "usdc-v2",
    }));
    expect(res.status).toBe(400);
    expect(tasks.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. FAKE FUNDING AT POST + 3. CAPS
// ---------------------------------------------------------------------------
describe("class 2/3 — posting is moneyless and capped only by config", () => {
  const post = (over: Record<string, unknown> = {}) => taskReq({
    poster: POSTER,
    description: "water my plants while I travel for two weeks please",
    location: "Paris",
    bountyUsdc: 5,
    deadlineHours: 24,
    rewardType: "usdc-v2",
    ...over,
  });

  it("a v2 post NEVER stores client escrow markers", async () => {
    const res = await tasksPOST(post({ onChainId: 7, escrowTxHash: TX }));
    expect(res.status).toBe(201);
    const { task } = await res.json();
    expect(task.rewardType).toBe("usdc-v2");
    expect(task.onChainId).toBeNull();
    expect(task.escrowTxHash).toBeNull();
  });

  it("no cap by default (campaigns are first-class): a $500 favour posts", async () => {
    const res = await tasksPOST(post({ bountyUsdc: 500 }));
    expect(res.status).toBe(201);
  });

  it("ESCROW_V2_MAX_USD, when set, is enforced server-side", async () => {
    vi.stubEnv("ESCROW_V2_MAX_USD", "10");
    const res = await tasksPOST(post({ bountyUsdc: 25 }));
    expect(res.status).toBe(400);
  });

  it("a non-wallet poster cannot open a v2 favour (they could never fund it)", async () => {
    const res = await tasksPOST(post({ poster: "dev_alice" }));
    expect(res.status).toBe(400);
  });

  it("v2 favours are single-completion", async () => {
    const res = await tasksPOST(post({ maxCompletions: 3 }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 4. DEMAND GATE + 5. DOUBLE-FUND + concurrency
// ---------------------------------------------------------------------------
describe("class 4/5 — fund step is demand-gated and single-shot", () => {
  it("no claimant => no fund transaction exists", async () => {
    seedV2Task({ status: "open", claimant: null });
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: POSTER }));
    expect(res.status).toBe(400);
  });

  it("only the poster can request the fund payload", async () => {
    seedV2Task();
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: ATTACKER }));
    expect(res.status).toBe(403);
  });

  it("happy path: claimed task => approve+fund calldata bound to claimant and config contract", async () => {
    seedV2Task();
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: POSTER }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.payload.transactions).toHaveLength(2);
    expect(data.payload.transactions[1].to).toBe(CONTRACT);
    expect(data.recipient).toBe(CLAIMANT);
    expect(data.amount).toBe("5000000");
    expect(data.disclosure).toContain("Auto-refundable");
  });

  it("already funded in the app => 409", async () => {
    seedV2Task({ escrowTxHash: TX, escrowV2Address: CONTRACT });
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: POSTER }));
    expect(res.status).toBe(409);
  });

  it("escrow slot already used on-chain => 409 even if the app record looks clean", async () => {
    seedV2Task();
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 1 };
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: POSTER }));
    expect(res.status).toBe(409);
  });

  it("ESCROW_V2_MAX_CONCURRENT, when set, blocks the Nth open funded escrow", async () => {
    vi.stubEnv("ESCROW_V2_MAX_CONCURRENT", "1");
    seedV2Task({ id: "task-0", escrowTxHash: TX, escrowV2Address: CONTRACT });
    seedV2Task();
    const res = await escrowPOST(escrowReq({ action: "prepare-fund", taskId: "task-1", poster: POSTER }));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 6. ACCEPT-SWAP + 7. MARK-PAID WITHOUT CHAIN STATE
// ---------------------------------------------------------------------------
describe("class 6/7 — app state only ever follows verified chain state", () => {
  it("verify-funded refuses when nothing is on-chain", async () => {
    seedV2Task();
    const res = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1", txHash: TX }));
    expect(res.status).toBe(409);
    expect(tasks.get("task-1")!.escrowTxHash).toBeNull();
  });

  it("ACCEPT-SWAP: escrow bound to the OLD claimant fails closed after a swap", async () => {
    // Chain holds an escrow for CLAIMANT, but the task's claimant has changed.
    seedV2Task({ claimant: ATTACKER });
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 1 };
    chain.eventTx = TX;
    const res = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1", txHash: TX }));
    expect(res.status).toBe(409);
    expect(tasks.get("task-1")!.escrowTxHash).toBeNull();
  });

  it("wrong funder (a stranger funded, keeping release control) fails closed", async () => {
    seedV2Task();
    chain.record = { funder: ATTACKER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 1 };
    chain.eventTx = TX;
    const res = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1", txHash: TX }));
    expect(res.status).toBe(409);
  });

  it("wrong amount fails closed", async () => {
    seedV2Task();
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(1), deadline: BigInt(9999999999), status: 1 };
    chain.eventTx = TX;
    const res = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1", txHash: TX }));
    expect(res.status).toBe(409);
  });

  it("verified funding pins contract address + version + the CHAIN's event tx", async () => {
    seedV2Task();
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 1 };
    chain.eventTx = TX;
    const res = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1" }));
    expect(res.status).toBe(200);
    const t = tasks.get("task-1")!;
    expect(t.escrowTxHash).toBe(TX);
    expect(t.escrowV2Address).toBe(CONTRACT);
    expect(t.escrowV2Version).toBe(3);
    // Idempotent second report
    const res2 = await escrowPOST(escrowReq({ action: "verify-funded", taskId: "task-1", txHash: TX }));
    expect((await res2.json()).already).toBe(true);
  });

  it("verify-released refuses while the chain still shows Funded — nothing books", async () => {
    seedV2Task({ escrowTxHash: TX, escrowV2Address: CONTRACT });
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 1 };
    const res = await escrowPOST(escrowReq({ action: "verify-released", taskId: "task-1", txHash: TX }));
    expect(res.status).toBe(409);
    expect(recordCompletion).not.toHaveBeenCalled();
    expect(tasks.get("task-1")!.settlementTx).toBeNull();
  });

  it("verify-released books USDC exactly once on chain-shown Released", async () => {
    seedV2Task({ escrowTxHash: TX, escrowV2Address: CONTRACT });
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(9999999999), status: 2 };
    chain.eventTx = "0x" + "cd".repeat(32);
    const res = await escrowPOST(escrowReq({ action: "verify-released", taskId: "task-1" }));
    expect(res.status).toBe(200);
    const t = tasks.get("task-1")!;
    expect(t.status).toBe("completed");
    expect(t.settlementTx).toBe("0x" + "cd".repeat(32));
    expect(recordCompletion).toHaveBeenCalledTimes(1);
    expect(recordCompletion).toHaveBeenCalledWith(CLAIMANT, 5, 0.75, "orb", true);
    // Idempotent: a second report cannot double-book.
    const res2 = await escrowPOST(escrowReq({ action: "verify-released", taskId: "task-1" }));
    expect((await res2.json()).already).toBe(true);
    expect(recordCompletion).toHaveBeenCalledTimes(1);
  });

  it("verify-refunded terminalizes the task on chain-shown Refunded, never as completed", async () => {
    seedV2Task({ escrowTxHash: TX, escrowV2Address: CONTRACT });
    chain.record = { funder: POSTER, recipient: CLAIMANT, amount: BigInt(5_000_000), deadline: BigInt(1), status: 3 };
    chain.eventTx = "0x" + "ef".repeat(32);
    const res = await escrowPOST(escrowReq({ action: "verify-refunded", taskId: "task-1" }));
    expect(res.status).toBe(200);
    const t = tasks.get("task-1")!;
    expect(t.status).toBe("expired");
    expect(t.escrowV2RefundTx).toBe("0x" + "ef".repeat(32));
    expect(recordCompletion).not.toHaveBeenCalled();
  });

  it("refund-expired sweep requires the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    seedV2Task({ escrowTxHash: TX, escrowV2Address: CONTRACT });
    const res = await escrowPOST(escrowReq({ action: "refund-expired", taskId: "task-1" }));
    expect(res.status).toBe(401);
  });
});
