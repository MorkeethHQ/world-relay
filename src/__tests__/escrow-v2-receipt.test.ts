import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// verifyEscrowV2Receipt decides whether a deposit counts for a favour. Until
// 9 Oct 2026 the only test that named it read the source text. A fault that
// accepted a deposit made for ANOTHER favour passed the whole suite.
//
// The chain client is replaced; the function under test is real.

const chain = vi.hoisted(() => ({ receipt: null as unknown, fail: false }));

vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({
    getTransactionReceipt: async () => {
      if (chain.fail) throw new Error("rpc down");
      return chain.receipt;
    },
  }),
}));

import { verifyEscrowV2Receipt, escrowV2TaskId, escrowV2Address } from "@/lib/escrow-v2";

const TX = `0x${"cd".repeat(32)}`;
const EVENT = `0x${"11".repeat(32)}` as `0x${string}`;
const OTHER_EVENT = `0x${"22".repeat(32)}`;

function receipt(over: { status?: string; address?: string; topic0?: string; taskId?: string } = {}) {
  return {
    status: over.status ?? "success",
    logs: [
      {
        address: over.address ?? escrowV2Address(),
        topics: [over.topic0 ?? EVENT, escrowV2TaskId(over.taskId ?? "task-a")],
      },
    ],
  };
}

let kept: string | undefined;
beforeEach(() => {
  kept = process.env.ESCROW_V2_ENABLED;
  process.env.ESCROW_V2_ENABLED = "1";
  chain.fail = false;
  chain.receipt = receipt();
});
afterEach(() => {
  if (kept === undefined) delete process.env.ESCROW_V2_ENABLED;
  else process.env.ESCROW_V2_ENABLED = kept;
});

describe("verifyEscrowV2Receipt", () => {
  it("accepts the deposit made for this favour", async () => {
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(true);
  });

  it("refuses a deposit made for another favour", async () => {
    chain.receipt = receipt({ taskId: "task-b" });
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });

  it("refuses the right favour id on another contract", async () => {
    chain.receipt = receipt({ address: "0x9999999999999999999999999999999999999999" });
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });

  it("refuses another event of the same contract and favour", async () => {
    chain.receipt = receipt({ topic0: OTHER_EVENT });
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });

  it("refuses a reverted transaction", async () => {
    chain.receipt = receipt({ status: "reverted" });
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });

  it("refuses when the chain cannot be read", async () => {
    chain.fail = true;
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });

  it("refuses a hash that is not a transaction hash", async () => {
    expect(await verifyEscrowV2Receipt("funded", EVENT, "task-a")).toBe(false);
  });

  it("refuses everything while the escrow switch is off", async () => {
    delete process.env.ESCROW_V2_ENABLED;
    expect(await verifyEscrowV2Receipt(TX, EVENT, "task-a")).toBe(false);
  });
});
