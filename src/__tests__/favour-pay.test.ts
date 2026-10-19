/**
 * PAID REVIEWS (FAVOUR-PAY, 19 Oct 2026). The money path on the EXISTING
 * escrow-v2 route with a paid slot task, plus the plan, the slot rules and the
 * one-confirm fund batch. The chain is mocked at the module boundary exactly as
 * escrow-v2-flow.guard.test.ts does; the route logic, the config source and the
 * builders are real.
 *
 * Covered: fund (one batch, K slots), release per review, refund after the
 * deadline, double release refused, a stranger cannot take two slots or the
 * builder's own slot.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { decodeFunctionData } from "viem";

const chain = vi.hoisted(() => ({
  records: new Map<string, { funder: string; recipient: string; amount: bigint; deadline: bigint; status: number }>(),
  eventTx: null as string | null,
}));

vi.mock("@/lib/escrow-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/escrow-v2")>();
  return {
    ...actual,
    getEscrowV2Record: vi.fn(async (id: string) => chain.records.get(id) ?? null),
    verifyEscrowV2Funded: vi.fn(async (id: string, e: { recipient: string; amount: bigint; funder: string }) => {
      const rec = chain.records.get(id);
      if (!rec) return null;
      const ok = rec.status === 1 && rec.recipient.toLowerCase() === e.recipient.toLowerCase() && rec.funder.toLowerCase() === e.funder.toLowerCase() && rec.amount === e.amount;
      return ok ? rec : null;
    }),
    verifyEscrowV2Receipt: vi.fn(async () => false),
    findEscrowV2EventTx: vi.fn(async () => chain.eventTx),
    refundExpiredEscrowV2: vi.fn(async () => null),
  };
});

// In-memory store with the real transition semantics for the fields the route writes.
type StoredTask = Record<string, unknown> & { id: string };
const tasks = vi.hoisted(() => new Map<string, StoredTask>());
vi.mock("@/lib/store", () => ({
  getTask: async (id: string) => tasks.get(id),
  listTasks: async () => Array.from(tasks.values()),
  createTask: async (input: Record<string, unknown>) => {
    const task = {
      id: `t${tasks.size + 1}`, claimant: null, status: "open", escrowTxHash: null, escrowV2Address: null, escrowV2Version: null,
      escrowV2RefundTx: null, settlementTx: null, pendingRelease: false, completionCount: 0,
      deadline: new Date(Date.now() + (Number(input.deadlineHours) || 24) * 3600_000).toISOString(),
      createdAt: new Date(Date.now() + tasks.size).toISOString(), agent: null, verificationResult: null, claimantVerification: null,
      ...input,
    };
    tasks.set(task.id, task);
    return task;
  },
  claimTask: async (id: string, claimant: string) => {
    const t = tasks.get(id);
    if (!t || t.status !== "open" || t.poster === claimant) return null;
    t.claimant = claimant; t.status = "claimed"; t.claimantVerification = "wallet";
    return t;
  },
  markEscrowV2Funded: async (id: string, info: { contractAddress: string; version: number; fundTxHash: string }) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2") return null;
    if (t.escrowTxHash && t.escrowV2Address) return t;
    t.escrowTxHash = info.fundTxHash; t.escrowV2Address = info.contractAddress; t.escrowV2Version = info.version;
    return t;
  },
  markEscrowV2Settled: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2" || !t.escrowV2Address) return null;
    t.status = "completed"; t.pendingRelease = false; t.settlementTx = tx;
    return t;
  },
  markEscrowV2Refunded: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2" || !t.escrowV2Address) return null;
    t.escrowV2RefundTx = tx; if (t.status !== "completed") t.status = "expired";
    return t;
  },
}));

// A fake redis with the calls the pay store and the draft reader make.
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, String(v)); return "OK"; },
    del: async (k: string) => { kv.delete(k); return 1; },
    smembers: async () => [], sadd: async () => 1,
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
const viewer = vi.hoisted(() => ({ wallet: null as string | null }));
vi.mock("@/lib/session", () => ({ ownershipError: () => null, ownerRefusal: () => null, getAuthedAddress: () => viewer.wallet }));
vi.mock("@/lib/reputation", () => ({ recordCompletion: async () => ({}), getReputation: async () => ({ currentStreak: 0 }) }));
vi.mock("@/lib/proof-of-favour", () => ({ recordFavourCompleted: async () => {}, completionPointsFor: () => 15 }));
vi.mock("@/lib/notifications", () => ({ notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/campaign-drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/campaign-drafts")>();
  return { ...actual, getPublishedCampaign: async (id: string) => (id === "draft_p1" ? { id, company: "STRIVE", productName: "STRIVE", productUrl: "https://striverun.app", brief: "Post one run and tell me the first step that was unclear to you", pieces: [], rewardPerPiecePoints: 10, pieceTaskIds: {}, companyChecked: false } : null) };
});

import { POST as escrowPOST } from "@/app/api/escrow-v2/route";
import { GET as payGET, POST as payPOST } from "@/app/api/projects/[id]/pay/route";
import { ESCROW_V2_ABI, PERMIT2_ADDRESS, PERMIT2_APPROVE_ABI, escrowV2Address, escrowV2TaskId, usdToUnits } from "@/lib/escrow-v2";
import { PAY_SLOTS, buildFundBatch, fundSummary, payPlanFromInput, payPlanOrNull, slotState, takeReason } from "@/lib/pay-plan";

const BUILDER = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAAAAAAAAaaaa";
const R1 = "0x244eEE7101fEE95D5040452d235dEa5A5bAA786b";
const R2 = "0x" + "bb".repeat(20);
const TX = "0x" + "ab".repeat(32);
const CONTRACT = escrowV2Address();
const P = "draft_p1";
const params = { params: Promise.resolve({ id: P }) };

const req = (url: string, body?: unknown) =>
  new Request(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined) as never;
const pay = (body: unknown) => payPOST(req(`http://localhost/api/projects/${P}/pay`, body), params);
const escrow = (body: unknown) => escrowPOST(req("http://localhost/api/escrow-v2", body));

async function fundOnChain(taskId: string, recipient: string, usd: number) {
  chain.records.set(taskId, { funder: BUILDER.toLowerCase(), recipient, amount: usdToUnits(usd), deadline: BigInt(Math.floor(Date.now() / 1000) + 10 * 86400), status: 1 });
  chain.eventTx = TX;
  const r = await escrow({ action: "verify-funded", taskId, txHash: TX });
  return { status: r.status, body: await r.json() };
}

beforeEach(() => {
  process.env.ESCROW_V2_ENABLED = "1";
  tasks.clear(); kv.clear(); chain.records.clear(); chain.eventTx = null;
  kv.set(`campaign:draft:${P}`, JSON.stringify({ id: P, owner: BUILDER.toLowerCase(), status: "published" }));
  kv.set(`campaign:pay:${P}`, JSON.stringify({ perReviewUsd: 2, slots: PAY_SLOTS, createdAt: "2026-10-19T00:00:00.000Z" }));
  viewer.wallet = null;
});

describe("the plan", () => {
  it("accepts 1, 2 or 5 USDC only, and the stored shape is checked again on the way out", () => {
    expect(payPlanFromInput({ perReviewUsd: 2 }, 0)?.slots).toBe(PAY_SLOTS);
    expect(payPlanFromInput({ perReviewUsd: 3 }, 0)).toBeNull();
    expect(payPlanFromInput(null, 0)).toBeNull();
    expect(payPlanOrNull('{"perReviewUsd":5,"slots":10}')?.perReviewUsd).toBe(5);
    expect(payPlanOrNull('{"perReviewUsd":5,"slots":99}')).toBeNull();
  });
  it("shows the sum, the count and the refund date before the builder confirms", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    const s = fundSummary({ perReviewUsd: 2, slots: 10, createdAt: "" }, [{ deadline: new Date(now + 7 * 86400_000).toISOString() }, { deadline: new Date(now + 7 * 86400_000).toISOString() }], now);
    expect(s.totalUsd).toBe(4);
    expect(s.count).toBe(2);
    // 7 days plus the 72 h confirm grace: 29 Oct 2026
    expect(s.refundAfter.slice(0, 10)).toBe("2026-10-29");
    expect(s.lines.join(" ")).toContain("FAVOUR never holds it");
  });
});

describe("taking a slot", () => {
  it("the builder cannot take a slot on their own project", async () => {
    viewer.wallet = BUILDER;
    const r = await pay({ action: "take" });
    expect(r.status).toBe(409);
  });
  it("one slot per wallet; a second take is refused", async () => {
    viewer.wallet = R1;
    expect((await pay({ action: "take" })).status).toBe(201);
    expect((await pay({ action: "take" })).status).toBe(409);
    expect(tasks.size).toBe(1);
    const t = tasks.get("t1")!;
    expect(t.rewardType).toBe("usdc-v2");
    expect(t.claimant).toBe(R1);
    expect(t.status).toBe("claimed");
    expect(t.bountyUsdc).toBe(2);
    expect(slotState(t as never)).toBe("taken");
  });
  it("the count is the plan's", () => {
    const slots = Array.from({ length: PAY_SLOTS }, (_, i) => ({ claimant: `0x${String(i).padStart(40, "0")}` })) as never;
    expect(takeReason({ perReviewUsd: 2, slots: PAY_SLOTS, createdAt: "" }, slots, R2, BUILDER)).toContain("Every paid slot");
  });
  it("no plan, no paid reviews", async () => {
    kv.delete(`campaign:pay:${P}`);
    viewer.wallet = R1;
    expect((await pay({ action: "take" })).status).toBe(404);
    const g = await payGET(req(`http://localhost/api/projects/${P}/pay`), params);
    expect((await g.json()).plan).toBeNull();
  });
});

describe("the money path on the existing escrow-v2 route", () => {
  async function twoSlots() {
    viewer.wallet = R1; await pay({ action: "take" });
    viewer.wallet = R2; await pay({ action: "take" });
    viewer.wallet = BUILDER;
  }

  it("FUND: one batch funds every taken slot; one Permit2 approve for the sum, one fund per slot, bound to each reviewer", async () => {
    await twoSlots();
    const r = await pay({ action: "prepare-fund" });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.summary.totalUsd).toBe(4);
    expect(b.summary.count).toBe(2);
    expect(b.payload.transactions).toHaveLength(3);
    expect(b.payload.transactions[0].to).toBe(PERMIT2_ADDRESS);
    const approve = decodeFunctionData({ abi: PERMIT2_APPROVE_ABI, data: b.payload.transactions[0].data });
    expect(approve.args?.[1]).toBe(CONTRACT);
    expect(approve.args?.[2]).toBe(usdToUnits(4));
    expect(approve.args?.[3]).toBe(0);
    const f1 = decodeFunctionData({ abi: ESCROW_V2_ABI, data: b.payload.transactions[1].data });
    const f2 = decodeFunctionData({ abi: ESCROW_V2_ABI, data: b.payload.transactions[2].data });
    expect(f1.functionName).toBe("fundWithPermit2");
    expect([f1.args?.[1], f2.args?.[1]].map((a) => String(a).toLowerCase())).toEqual([R1.toLowerCase(), R2]);
    expect([f1.args?.[0], f2.args?.[0]]).toEqual([escrowV2TaskId("t1"), escrowV2TaskId("t2")]);
    expect(f1.args?.[2]).toBe(usdToUnits(2));
  });

  it("FUND: a stranger and a reviewer cannot prepare the builder's fund", async () => {
    await twoSlots();
    viewer.wallet = R1;
    expect((await pay({ action: "prepare-fund" })).status).toBe(403);
  });

  it("FUND: the app marks a slot funded only when the chain shows Funded for THAT reviewer and amount", async () => {
    await twoSlots();
    // Wrong recipient on chain: refused.
    chain.records.set("t1", { funder: BUILDER.toLowerCase(), recipient: R2, amount: usdToUnits(2), deadline: BigInt(2_000_000_000), status: 1 });
    chain.eventTx = TX;
    expect((await escrow({ action: "verify-funded", taskId: "t1", txHash: TX })).status).toBe(409);
    expect(tasks.get("t1")!.escrowTxHash).toBeNull();
    // Right record: funded.
    const ok = await fundOnChain("t1", R1, 2);
    expect(ok.body.funded).toBe(true);
    expect(slotState(tasks.get("t1") as never)).toBe("funded");
    // Once funded, the batch leaves it out.
    const again = await (await pay({ action: "prepare-fund" })).json();
    expect(again.summary.count).toBe(1);
    expect(again.slots[0].taskId).toBe("t2");
  });

  it("RELEASE per review: the builder releases one slot; the other stays funded", async () => {
    await twoSlots();
    await fundOnChain("t1", R1, 2);
    await fundOnChain("t2", R2, 2);
    const prep = await escrow({ action: "prepare-release", taskId: "t1", poster: BUILDER.toLowerCase() });
    expect(prep.status).toBe(200);
    const d = decodeFunctionData({ abi: ESCROW_V2_ABI, data: (await prep.json()).payload.transactions[0].data });
    expect(d.functionName).toBe("release");
    chain.records.get("t1")!.status = 2;
    const ver = await escrow({ action: "verify-released", taskId: "t1", txHash: TX });
    expect((await ver.json()).released).toBe(true);
    expect(slotState(tasks.get("t1") as never)).toBe("paid");
    expect(slotState(tasks.get("t2") as never)).toBe("funded");
  });

  it("DOUBLE RELEASE refused: a released slot cannot be prepared again, and a second verify books nothing new", async () => {
    await twoSlots();
    await fundOnChain("t1", R1, 2);
    chain.records.get("t1")!.status = 2;
    await escrow({ action: "verify-released", taskId: "t1", txHash: TX });
    const first = tasks.get("t1")!.settlementTx;
    expect((await escrow({ action: "prepare-release", taskId: "t1", poster: BUILDER.toLowerCase() })).status).toBe(409);
    const again = await (await escrow({ action: "verify-released", taskId: "t1", txHash: "0x" + "cd".repeat(32) })).json();
    expect(again.already).toBe(true);
    expect(tasks.get("t1")!.settlementTx).toBe(first);
  });

  it("REFUND: not before the deadline; after it, the slot goes back to the builder and cannot be released", async () => {
    await twoSlots();
    await fundOnChain("t1", R1, 2);
    expect((await escrow({ action: "prepare-refund", taskId: "t1" })).status).toBe(409);
    chain.records.get("t1")!.deadline = BigInt(Math.floor(Date.now() / 1000) - 10);
    const prep = await escrow({ action: "prepare-refund", taskId: "t1" });
    expect(prep.status).toBe(200);
    chain.records.get("t1")!.status = 3;
    const ver = await (await escrow({ action: "verify-refunded", taskId: "t1", txHash: TX })).json();
    expect(ver.refunded).toBe(true);
    expect(slotState(tasks.get("t1") as never)).toBe("refunded");
    expect((await escrow({ action: "prepare-release", taskId: "t1", poster: BUILDER.toLowerCase() })).status).toBe(409);
  });

  it("GET: wallets go to the builder and to the slot holder only", async () => {
    await twoSlots();
    viewer.wallet = null;
    const anon = await (await payGET(req(`http://localhost/api/projects/${P}/pay`), params)).json();
    expect(anon.slots.every((s: { reviewer: string | null }) => s.reviewer === null)).toBe(true);
    expect(anon.counts.taken).toBe(2);
    viewer.wallet = R1;
    const mine = await (await payGET(req(`http://localhost/api/projects/${P}/pay`), params)).json();
    expect(mine.mine.taskId).toBe("t1");
    expect(mine.slots.map((s: { reviewer: string | null }) => s.reviewer)).toEqual([R1, null]);
    viewer.wallet = BUILDER;
    const owner = await (await payGET(req(`http://localhost/api/projects/${P}/pay`), params)).json();
    expect(owner.isOwner).toBe(true);
    expect(owner.fund.totalUsd).toBe(4);
  });

  it("DARK RAIL: with the flag off, nothing can be taken or funded", async () => {
    delete process.env.ESCROW_V2_ENABLED;
    viewer.wallet = R1;
    expect((await pay({ action: "take" })).status).toBe(404);
    expect(buildFundBatch([{ taskId: "x", recipient: R1, usd: 2, deadline: BigInt(1) }])).toBeNull();
  });
});
