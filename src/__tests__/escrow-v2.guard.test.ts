/**
 * GUARD: FavourEscrowV2 rail stays DARK unless ESCROW_V2_ENABLED=1, and the
 * ABI structurally forbids the redirect (question-swap) class.
 *
 * If any of these fail, the new money rail's gating or binding has changed —
 * that is an Oscar-level ruling, not a refactor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ESCROW_V2_ADDRESS,
  ESCROW_V2_ABI,
  escrowV2Enabled,
  escrowV2TaskId,
  buildFundTransaction,
  buildReleaseTransaction,
  refundExpiredEscrowV2,
} from "@/lib/escrow-v2";

const RECIPIENT = "0x244eEE7101fEE95D5040452d235dEa5A5bAA786b" as const;

describe("escrow-v2 dark-by-default gate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ESCROW_V2_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag absent/empty => rail is dark", () => {
    expect(escrowV2Enabled()).toBe(false);
  });

  it("flag values other than '1' do not open the rail", () => {
    for (const v of ["true", "yes", "on", "0", "enabled"]) {
      vi.stubEnv("ESCROW_V2_ENABLED", v);
      expect(escrowV2Enabled()).toBe(false);
    }
  });

  it("every tx builder returns null when dark", async () => {
    expect(buildFundTransaction("t1", RECIPIENT, BigInt(1000000), BigInt(2000000000))).toBeNull();
    expect(buildReleaseTransaction("t1")).toBeNull();
    await expect(refundExpiredEscrowV2("t1")).resolves.toBeNull();
  });

  it("flag=1 opens the builders with bound args", () => {
    vi.stubEnv("ESCROW_V2_ENABLED", "1");
    const tx = buildFundTransaction("t1", RECIPIENT, BigInt(1000000), BigInt(2000000000));
    expect(tx).not.toBeNull();
    expect(tx!.address).toBe(ESCROW_V2_ADDRESS);
    expect(tx!.args[0]).toBe(escrowV2TaskId("t1"));
    expect(tx!.args[1]).toBe(RECIPIENT);
    expect(tx!.args[2]).toBe("1000000");
  });
});

describe("escrow-v2 binding invariants", () => {
  it("deployed address is the verified mainnet contract", () => {
    expect(ESCROW_V2_ADDRESS).toBe("0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C");
  });

  it("taskId hash is deterministic and matches the on-chain demo escrow", () => {
    // The 2026-07-30 mainnet demo funded exactly this hash for this app task.
    expect(escrowV2TaskId("20c5a8fe-b664-40a0-8655-de546f8ec37b")).toBe(
      "0x25e20cfe5d30ac35d61176693b68529deb3722df1e53a4a11ddc18f47adbb6fa"
    );
    expect(escrowV2TaskId("a")).toBe(escrowV2TaskId("a"));
    expect(escrowV2TaskId("a")).not.toBe(escrowV2TaskId("b"));
  });

  it("REDIRECT CLASS: release and refund accept no address anywhere", () => {
    for (const fn of ESCROW_V2_ABI) {
      if (fn.name === "release" || fn.name === "refund") {
        expect(fn.inputs).toHaveLength(1);
        expect(fn.inputs[0].type).toBe("bytes32");
      }
    }
  });

  it("fund is the ONLY state-changing function that takes an address", () => {
    const writers = ESCROW_V2_ABI.filter(
      (f) => f.stateMutability === "nonpayable"
    );
    const withAddress = writers.filter((f) =>
      f.inputs.some((i) => i.type === "address")
    );
    expect(withAddress.map((f) => f.name)).toEqual(["fund"]);
  });
});
