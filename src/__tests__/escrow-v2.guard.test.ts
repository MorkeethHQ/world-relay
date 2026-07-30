/**
 * GUARD: FavourEscrowV2 rail stays DARK unless ESCROW_V2_ENABLED=1, the ABI
 * structurally forbids the redirect (question-swap) class, and the rail is
 * REPLACEABLE BY CONFIG (address + caps resolve from env with safe defaults).
 *
 * If any of these fail, the new money rail's gating, binding or config source
 * has changed — that is an Oscar-level ruling, not a refactor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ESCROW_V2_ABI,
  ESCROW_V2_VERSION,
  ESCROW_V2_MAX_DURATION_S,
  escrowV2Address,
  escrowV2Enabled,
  escrowV2MaxUsd,
  escrowV2MaxConcurrent,
  escrowV2TaskId,
  escrowV2DeadlineFor,
  usdToUnits,
  buildFundTransactions,
  buildReleaseTransaction,
  buildRefundTransaction,
  refundExpiredEscrowV2,
} from "@/lib/escrow-v2";
import { USDC_ADDRESS, WORLD_CHAIN_ID } from "@/lib/contracts";

const DEPLOYED = "0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C";
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
    expect(buildFundTransactions("t1", RECIPIENT, BigInt(1000000), BigInt(2000000000))).toBeNull();
    expect(buildReleaseTransaction("t1")).toBeNull();
    expect(buildRefundTransaction("t1")).toBeNull();
    await expect(refundExpiredEscrowV2("t1")).resolves.toBeNull();
  });

  it("flag=1 opens the builders with MiniKit-ready calldata bound to the config address", () => {
    vi.stubEnv("ESCROW_V2_ENABLED", "1");
    const payload = buildFundTransactions("t1", RECIPIENT, BigInt(1000000), BigInt(2000000000));
    expect(payload).not.toBeNull();
    expect(payload!.chainId).toBe(WORLD_CHAIN_ID);
    expect(payload!.transactions).toHaveLength(2);
    // [0] approve on the token, [1] fund on the escrow — BOTH must be portal-whitelisted.
    expect(payload!.transactions[0].to).toBe(USDC_ADDRESS);
    expect(payload!.transactions[1].to).toBe(escrowV2Address());
    // The fund calldata embeds the deterministic taskId hash — recipient binding
    // happens inside the contract from these exact args.
    expect(payload!.transactions[1].data).toContain(escrowV2TaskId("t1").slice(2));
    expect(payload!.transactions[1].data.toLowerCase()).toContain(RECIPIENT.slice(2).toLowerCase());
  });
});

describe("escrow-v2 is replaceable by config (never cornered)", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("address defaults to the deployed, source-verified contract", () => {
    expect(escrowV2Address()).toBe(DEPLOYED);
  });

  it("ESCROW_V2_CONTRACT env flips the address — the v2.1 migration IS this flip", () => {
    const next = "0x1111111111111111111111111111111111111111";
    vi.stubEnv("ESCROW_V2_CONTRACT", next);
    expect(escrowV2Address()).toBe(next);
  });

  it("a malformed env address is ignored, never half-used", () => {
    for (const bad of ["not-an-address", "0x123", "0x" + "g".repeat(40), ""]) {
      vi.stubEnv("ESCROW_V2_CONTRACT", bad);
      expect(escrowV2Address()).toBe(DEPLOYED);
    }
  });

  it("release/refund builders accept a pinned address override (funded tasks keep resolving after a flip)", () => {
    vi.stubEnv("ESCROW_V2_ENABLED", "1");
    vi.stubEnv("ESCROW_V2_CONTRACT", "0x1111111111111111111111111111111111111111");
    const pinned = DEPLOYED as `0x${string}`;
    expect(buildReleaseTransaction("t1", pinned)!.transactions[0].to).toBe(pinned);
    expect(buildRefundTransaction("t1", pinned)!.transactions[0].to).toBe(pinned);
  });

  it("caps are UNLIMITED when unset or 0, exact when set (Oscar's ruling: no arbitrary launch ceiling)", () => {
    expect(escrowV2MaxUsd()).toBe(Infinity);
    expect(escrowV2MaxConcurrent()).toBe(Infinity);
    vi.stubEnv("ESCROW_V2_MAX_USD", "0");
    vi.stubEnv("ESCROW_V2_MAX_CONCURRENT", "0");
    expect(escrowV2MaxUsd()).toBe(Infinity);
    expect(escrowV2MaxConcurrent()).toBe(Infinity);
    vi.stubEnv("ESCROW_V2_MAX_USD", "10");
    vi.stubEnv("ESCROW_V2_MAX_CONCURRENT", "3");
    expect(escrowV2MaxUsd()).toBe(10);
    expect(escrowV2MaxConcurrent()).toBe(3);
    vi.stubEnv("ESCROW_V2_MAX_USD", "garbage");
    expect(escrowV2MaxUsd()).toBe(Infinity);
  });

  it("version constant is stamped for task pinning", () => {
    expect(ESCROW_V2_VERSION).toBe(2);
  });
});

describe("escrow-v2 binding invariants", () => {
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

  it("usd->units is exact 6-decimal money math", () => {
    expect(usdToUnits(1)).toBe(BigInt(1_000_000));
    expect(usdToUnits(0.5)).toBe(BigInt(500_000));
    expect(usdToUnits(123.45)).toBe(BigInt(123_450_000));
  });

  it("escrow deadline = task deadline + confirm grace, always inside the contract's 180d cap", () => {
    const now = Date.UTC(2026, 6, 31);
    const in24h = new Date(now + 24 * 3600_000).toISOString();
    const d = escrowV2DeadlineFor(in24h, now);
    // 24h task deadline + 72h grace
    expect(Number(d)).toBe(Math.floor(now / 1000) + (24 + 72) * 3600);
    // A pathological far-future deadline is clamped under MAX_DURATION so
    // fund() can never revert DeadlineInvalid.
    const in10y = new Date(now + 3650 * 24 * 3600_000).toISOString();
    const clamped = escrowV2DeadlineFor(in10y, now);
    expect(Number(clamped)).toBeLessThan(Math.floor(now / 1000) + ESCROW_V2_MAX_DURATION_S);
    // And a deadline already in the past still yields a valid future escrow deadline.
    const past = new Date(now - 3600_000).toISOString();
    expect(Number(escrowV2DeadlineFor(past, now))).toBeGreaterThan(Math.floor(now / 1000));
  });
});
