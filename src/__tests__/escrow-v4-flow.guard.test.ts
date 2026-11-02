/**
 * ADVERSARIAL GUARD: the FavourPots rail (version 4) inside /api/escrow-v2, plus the switch-over.
 *
 * Classes covered:
 *   A. ROUTING — pinned V2_1 tasks (version 3) stay on V2_1; unpinned tasks fund on v4; an
 *      unpinned task whose V2_1 funding was already signed finishes on V2_1.
 *   B. FUND — poster-only, open or claimed, 0.1 USDC works, below 0.1 refused, releaser = server key,
 *      payload targets Permit2 then FavourPots.
 *   C. MARK-FUNDED ONLY ON CHAIN TRUTH — wrong funder / amount / releaser / no event => refused.
 *   D. RELEASE — poster-only payload to the claimant; review-release needs ADMIN_SECRET; booking
 *      happens once and fees are withdrawn after the payout.
 *   E. REFUND — only after the deadline, only when the chain shows Refunded.
 *   F. FEE LINE — the pay screen shows the pinned fee.
 *
 * Chain reads/writes are mocked at the module boundary; route logic, ids and builders are real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { NextRequest } from "next/server";

const chain = vi.hoisted(() => ({
  v2Record: null as null | { status: number; amount?: bigint; recipient?: string; funder?: string; deadline?: bigint },
  favour: null as null | {
    funder: string; deadline: bigint; feeBps: number; status: number; releaser: string; token: string; amount: bigint;
  },
  eventTx: null as string | null,
  released: [] as Array<{ id: string; to: string }>,
  withdrawn: 0,
}));

const OPERATOR = "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e";

vi.mock("@/lib/escrow-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/escrow-v2")>();
  return { ...actual, getEscrowV2Record: vi.fn(async () => chain.v2Record), findEscrowV2EventTx: vi.fn(async () => null) };
});

vi.mock("@/lib/favour-pots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/favour-pots")>();
  return {
    ...actual,
    operatorAddress: () => OPERATOR,
    currentFeeBps: async () => 250,
    getFavourRecord: vi.fn(async () => chain.favour),
    findPotsEventTx: vi.fn(async () => chain.eventTx),
    verifyPotsReceipt: vi.fn(async () => false),
    serverReleaseFavour: vi.fn(async (id: string, to: string) => {
      chain.released.push({ id, to });
      return "0x" + "cd".repeat(32);
    }),
    serverRefundFavour: vi.fn(async () => "0x" + "ef".repeat(32)),
    withdrawFeesBestEffort: vi.fn(async () => {
      chain.withdrawn++;
      return null;
    }),
  };
});

type StoredTask = Record<string, unknown> & { id: string };
const tasks = new Map<string, StoredTask>();
vi.mock("@/lib/store", () => ({
  getTask: async (id: string) => tasks.get(id),
  listTasks: async () => Array.from(tasks.values()),
  markEscrowV2Funded: async (id: string, info: { contractAddress: string; version: number; fundTxHash: string }) => {
    const t = tasks.get(id);
    if (!t || t.rewardType !== "usdc-v2") return null;
    if (t.escrowTxHash && t.escrowV2Address) return t;
    Object.assign(t, { escrowTxHash: info.fundTxHash, escrowV2Address: info.contractAddress, escrowV2Version: info.version });
    return t;
  },
  markEscrowV2Settled: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || !t.escrowV2Address) return null;
    Object.assign(t, { status: "completed", settlementTx: tx });
    return t;
  },
  markEscrowV2Refunded: async (id: string, tx: string) => {
    const t = tasks.get(id);
    if (!t || !t.escrowV2Address) return null;
    Object.assign(t, { escrowV2RefundTx: tx, status: "expired" });
    return t;
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/session", () => ({ ownershipError: () => null, ownerRefusal: () => null, getAuthedAddress: () => null }));
const recordCompletion = vi.fn(async () => ({}));
vi.mock("@/lib/reputation", () => ({
  recordCompletion: (...a: unknown[]) => (recordCompletion as (...x: unknown[]) => unknown)(...a),
  getReputation: async () => ({ currentStreak: 0 }),
}));
vi.mock("@/lib/proof-of-favour", () => ({
  recordFavourCompleted: async () => {},
  recordFundingReward: async () => {},
  completionPointsFor: () => 15,
}));
vi.mock("@/lib/notifications", () => ({ notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { GET, POST } from "@/app/api/escrow-v2/route";
import { favourIdFor, favourKey, favourPotsAddress, FAVOUR_POTS_VERSION } from "@/lib/favour-pots";
import { FAVOUR_POTS_ABI } from "@/lib/favour-pots-v3";
import { PERMIT2_ADDRESS, escrowV2Address } from "@/lib/escrow-v2";
import { USDC_ADDRESS } from "@/lib/contracts";

const POSTER = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAAAAAAAAaaaa";
const HELPER = "0x3648b7f52f8f1dff9c412c032271cf3f386b4443";
const TX = "0x" + "ab".repeat(32);

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/escrow-v2", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never);
const get = (taskId?: string) => GET(new NextRequest(`http://localhost/api/escrow-v2${taskId ? `?taskId=${taskId}` : ""}`) as never);

function seed(over: Record<string, unknown> = {}) {
  const t = {
    id: "fav-1", poster: POSTER, claimant: null, status: "open", rewardType: "usdc-v2", bountyUsdc: 0.1,
    description: "try my app and say what confused you", deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
    escrowTxHash: null, escrowV2Address: null, escrowV2Version: null, escrowV2RefundTx: null, settlementTx: null,
    pendingRelease: false, verificationResult: null, claimantVerification: null, ...over,
  };
  tasks.set(t.id, t as StoredTask);
  return t;
}
const funded = (over: Record<string, unknown> = {}) => ({
  funder: POSTER, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), feeBps: 250, status: 1,
  releaser: OPERATOR, token: USDC_ADDRESS, amount: BigInt(100_000), ...over,
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ESCROW_V2_ENABLED", "1");
  vi.stubEnv("ADMIN_SECRET", "s3cret-admin");
  tasks.clear();
  Object.assign(chain, { v2Record: null, favour: null, eventTx: null, released: [], withdrawn: 0 });
  recordCompletion.mockClear();
});

describe("A. routing and switch-over", () => {
  it("rail info: new fundings go to FavourPots with the fee and 0.1 minimum", async () => {
    const r = await (await get()).json();
    expect(r.rail).toBe(4);
    expect(r.contract).toBe(favourPotsAddress());
    expect(r.feeBps).toBe(250);
    expect(r.minUsd).toBe(0.1);
  });

  it("FAVOUR_RAIL=v2 rolls new fundings back to V2_1 in one line", async () => {
    vi.stubEnv("FAVOUR_RAIL", "v2");
    const r = await (await get()).json();
    expect(r.contract).toBe(escrowV2Address());
    expect(r.rail).toBeUndefined();
  });

  it("a task PINNED to V2_1 keeps the V2_1 path (release payload targets V2_1, not FavourPots)", async () => {
    seed({ status: "claimed", claimant: HELPER, escrowTxHash: TX, escrowV2Address: escrowV2Address(), escrowV2Version: 3 });
    chain.v2Record = { status: 1, amount: BigInt(100_000), recipient: HELPER, funder: POSTER, deadline: BigInt(0) };
    const res = await post({ action: "prepare-release", taskId: "fav-1", poster: POSTER });
    const body = await res.json();
    // V2_1 mock record lacks a recipient, so V2_1 returns a payload to the pinned V2_1 address.
    expect(body.rail).toBeUndefined();
    expect(body.payload.transactions[0].to.toLowerCase()).toBe(escrowV2Address().toLowerCase());
  });

  it("an unpinned task already funded on V2_1 before the switch finishes on V2_1", async () => {
    seed({ status: "claimed", claimant: HELPER });
    chain.v2Record = { status: 1, amount: BigInt(100_000), recipient: HELPER, funder: POSTER, deadline: BigInt(0) };
    const body = await (await get("fav-1")).json();
    expect(body.rail).toBeUndefined();
    expect(body.address.toLowerCase()).toBe(escrowV2Address().toLowerCase());
  });
});

describe("B. fund", () => {
  it("0.1 USDC: poster gets [permit2.approve, fundFavourWithPermit2] with the server key as releaser", async () => {
    seed();
    const res = await post({ action: "prepare-fund", taskId: "fav-1", poster: POSTER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rail).toBe(4);
    const [approve, fund] = body.payload.transactions;
    expect(approve.to).toBe(PERMIT2_ADDRESS);
    expect(fund.to).toBe(favourPotsAddress());
    const d = decodeFunctionData({ abi: FAVOUR_POTS_ABI, data: fund.data });
    expect(d.functionName).toBe("fundFavourWithPermit2");
    const [key, token, amount, releaser] = d.args as readonly [string, string, bigint, string, bigint];
    expect(key).toBe(favourKey("fav-1"));
    expect(token).toBe(USDC_ADDRESS);
    expect(amount).toBe(BigInt(100_000));
    expect(releaser).toBe(OPERATOR);
    expect(body.feeLine).toContain("2.5%");
    expect(body.favourId).toBe(favourIdFor(POSTER, "fav-1"));
  });

  it("can fund while open (no helper yet) and while claimed", async () => {
    seed({ status: "claimed", claimant: HELPER });
    expect((await post({ action: "prepare-fund", taskId: "fav-1", poster: POSTER })).status).toBe(200);
  });

  it("below 0.1 USDC is refused", async () => {
    seed({ bountyUsdc: 0.09 });
    const res = await post({ action: "prepare-fund", taskId: "fav-1", poster: POSTER });
    expect(res.status).toBe(400);
  });

  it("only the poster can fund", async () => {
    seed();
    expect((await post({ action: "prepare-fund", taskId: "fav-1", poster: HELPER })).status).toBe(403);
  });

  it("refuses when the on-chain slot is taken", async () => {
    seed();
    chain.favour = funded();
    expect((await post({ action: "prepare-fund", taskId: "fav-1", poster: POSTER })).status).toBe(409);
  });
});

describe("C. verify-funded follows the chain only", () => {
  it("nothing on-chain => refused", async () => {
    seed();
    expect((await post({ action: "verify-funded", taskId: "fav-1" })).status).toBe(409);
  });
  it("wrong funder, amount or releaser => refused", async () => {
    seed();
    chain.eventTx = TX;
    for (const bad of [{ funder: HELPER }, { amount: BigInt(99_999) }, { releaser: HELPER }]) {
      chain.favour = funded(bad);
      expect((await post({ action: "verify-funded", taskId: "fav-1" })).status).toBe(409);
    }
  });
  it("record ok but no event => refused", async () => {
    seed();
    chain.favour = funded();
    expect((await post({ action: "verify-funded", taskId: "fav-1" })).status).toBe(409);
  });
  it("record + event => pinned to FavourPots version 4", async () => {
    seed();
    chain.favour = funded();
    chain.eventTx = TX;
    const body = await (await post({ action: "verify-funded", taskId: "fav-1" })).json();
    expect(body.funded).toBe(true);
    const t = tasks.get("fav-1")!;
    expect(t.escrowV2Version).toBe(FAVOUR_POTS_VERSION);
    expect(t.escrowV2Address).toBe(favourPotsAddress());
    expect(t.escrowTxHash).toBe(TX);
  });
});

describe("D. release", () => {
  const pinned = { status: "claimed", claimant: HELPER, escrowTxHash: TX, escrowV2Address: "", escrowV2Version: 4 };
  beforeEach(() => { pinned.escrowV2Address = favourPotsAddress(); });

  it("poster gets releaseFavour(id, claimant)", async () => {
    seed(pinned);
    chain.favour = funded();
    const body = await (await post({ action: "prepare-release", taskId: "fav-1", poster: POSTER })).json();
    const d = decodeFunctionData({ abi: FAVOUR_POTS_ABI, data: body.payload.transactions[0].data });
    expect(d.functionName).toBe("releaseFavour");
    const [rid, rto] = d.args as readonly [string, string];
    expect(rid).toBe(favourIdFor(POSTER, "fav-1"));
    expect(rto.toLowerCase()).toBe(HELPER.toLowerCase());
  });

  it("no helper yet => cannot release", async () => {
    seed({ ...pinned, claimant: null });
    chain.favour = funded();
    expect((await post({ action: "prepare-release", taskId: "fav-1", poster: POSTER })).status).toBe(400);
  });

  it("review-release needs the admin secret", async () => {
    seed(pinned);
    chain.favour = funded();
    expect((await post({ action: "review-release", taskId: "fav-1", secret: "wrong" })).status).toBe(401);
    expect(chain.released).toHaveLength(0);
  });

  it("review-release with the secret: server pays the claimant, books once, withdraws fees", async () => {
    seed(pinned);
    chain.favour = funded();
    const body = await (await post({ action: "review-release", taskId: "fav-1", secret: "s3cret-admin" })).json();
    expect(body.released).toBe(true);
    expect(chain.released).toEqual([{ id: favourIdFor(POSTER, "fav-1"), to: HELPER }]);
    expect(recordCompletion).toHaveBeenCalledTimes(1);
    expect(chain.withdrawn).toBe(1);
  });

  it("verify-released only when the chain shows Released and an event exists", async () => {
    seed(pinned);
    chain.favour = funded();
    expect((await post({ action: "verify-released", taskId: "fav-1" })).status).toBe(409);
    chain.favour = funded({ status: 2 });
    expect((await post({ action: "verify-released", taskId: "fav-1" })).status).toBe(409);
    chain.eventTx = TX;
    const body = await (await post({ action: "verify-released", taskId: "fav-1" })).json();
    expect(body.released).toBe(true);
    expect(tasks.get("fav-1")!.status).toBe("completed");
    expect(chain.withdrawn).toBe(1);
  });
});

describe("E. refund", () => {
  it("not before the deadline; after it the payload refunds by id", async () => {
    seed({ status: "open", escrowTxHash: TX, escrowV2Address: favourPotsAddress(), escrowV2Version: 4 });
    chain.favour = funded();
    expect((await post({ action: "prepare-refund", taskId: "fav-1" })).status).toBe(409);
    chain.favour = funded({ deadline: BigInt(Math.floor(Date.now() / 1000) - 10) });
    const body = await (await post({ action: "prepare-refund", taskId: "fav-1" })).json();
    const d = decodeFunctionData({ abi: FAVOUR_POTS_ABI, data: body.payload.transactions[0].data });
    expect(d.functionName).toBe("refundFavour");
  });

  it("verify-refunded only on chain Refunded + event", async () => {
    seed({ status: "open", escrowTxHash: TX, escrowV2Address: favourPotsAddress(), escrowV2Version: 4 });
    chain.favour = funded({ status: 3 });
    expect((await post({ action: "verify-refunded", taskId: "fav-1" })).status).toBe(409);
    chain.eventTx = TX;
    expect((await (await post({ action: "verify-refunded", taskId: "fav-1" })).json()).refunded).toBe(true);
  });
});

describe("F. fee line on the pay screen", () => {
  it("GET state shows the helper's net and the 2.5% fee", async () => {
    seed({ bountyUsdc: 1 });
    const body = await (await get("fav-1")).json();
    expect(body.rail).toBe(4);
    expect(body.feeLine).toBe("Helper receives $0.975. FAVOUR fee 2.5% ($0.025) is taken at payout, never on deposit or refund.");
    expect(body.netToHelper).toBe("975000");
  });
});
