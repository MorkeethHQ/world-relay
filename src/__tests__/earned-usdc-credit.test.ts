import { describe, it, expect, vi } from "vitest";
import { recordCompletion } from "@/lib/reputation";
import { isRealMoney, hasOnChainEscrow } from "@/lib/reward";

// Inv 1 guard: points must never be booked as dollars.
//
// History this encodes. Before 9060dda (Jul 4) recordCompletion did an
// unconditional `rep.totalEarnedUsdc += bountyUsdc`, and a points task carries its
// POINTS value (0.5-10) in bountyUsdc. Every points completion banked as dollars.
// 9060dda added the isFundedTask split and fixed writes — with no backfill, so
// $278 of phantom USDC sat in prod for 13 days across 24 wallets (one wallet read
// $150 against a real $6, and /api/reputation served it publicly via `...rep`).
// scripts/backfill-earned-usdc.ts undid the data; this stops the write recurring.
//
// The subtle half — the reason a "just tighten the funded check" fix would have
// been WRONG. verify-proof/route.ts derives TWO signals whose safe defaults point
// in opposite directions:
//   taskIsFunded    LOOSE  (onChainId != null || !!escrowTxHash) -> security gates.
//                          Fail-safe: leaning loose only adds protection.
//   taskIsRealMoney STRICT (onChainId != null && /^0x[0-9a-f]{64}$/) -> reputation.
//                          Fail-closed: only a real escrow tx may become dollars.
// Tightening the single old signal globally would have NARROWED the tier gate and
// weakened security while fixing the credit. They must stay separate.
//
// A placeholder escrowTxHash of "funded" is not hypothetical: legacy seeds shipped
// exactly that string and passed every truthiness funding guard (Inv 3, see the
// note in api/seed/route.ts).

const rep = (addr: string) => `0x${addr.repeat(40).slice(0, 40)}`;

vi.mock("@/lib/redis", () => ({ getRedis: () => null })); // no store; assert the returned record

describe("Inv 1: only real escrow becomes dollars", () => {
  it("a points task NEVER credits totalEarnedUsdc, however large its value", async () => {
    const r = await recordCompletion(rep("a"), 10, 0.9, "orb", false);
    expect(r.totalEarnedUsdc).toBe(0);
    expect(r.totalPointsEarned).toBe(10);
  });

  it("a genuinely funded task credits dollars, not points", async () => {
    const r = await recordCompletion(rep("b"), 2, 0.9, "orb", true);
    expect(r.totalEarnedUsdc).toBe(2);
    expect(r.totalPointsEarned).toBe(0);
  });

  it("the exact prod shape: 10-point campaign posts never become $10", async () => {
    const addr = rep("c");
    for (let i = 0; i < 5; i++) await recordCompletion(addr, 10, 0.9, "orb", false);
    const r = await recordCompletion(addr, 10, 0.9, "orb", false);
    // 6 clean campaign posts. Pre-9060dda this read $60.
    expect(r.totalEarnedUsdc).toBe(0);
    expect(r.totalPointsEarned).toBe(60);
    expect(r.tasksCompleted).toBe(6);
  });
});

// This block imports the REAL exported helpers the route calls. An earlier draft
// re-declared the predicate inline, which would have stayed green through any
// change to the route — a doc aid, not a gate (SECURITY-INVARIANTS.md).
describe("the credit signal: truthiness is not funding", () => {
  const REAL = `0x${"a".repeat(64)}`;
  // The route's credit signal, composed from the same source it imports.
  const credit = (t: any) => isRealMoney(t) && hasOnChainEscrow(t);

  it('the legacy "funded" placeholder is NOT creditable', () => {
    expect(credit({ rewardType: "usdc", onChainId: 1, escrowTxHash: "funded" })).toBe(false);
  });

  it("an onChainId alone is NOT creditable", () => {
    expect(credit({ rewardType: "usdc", onChainId: 7, escrowTxHash: null })).toBe(false);
  });

  it("a tx hash without an onChainId is NOT creditable", () => {
    expect(credit({ rewardType: "usdc", onChainId: null, escrowTxHash: REAL })).toBe(false);
  });

  it("a truncated / malformed hash is NOT creditable", () => {
    expect(credit({ rewardType: "usdc", onChainId: 1, escrowTxHash: "0xdeadbeef" })).toBe(false);
  });

  it("a POINTS task with a real escrow tx is still NOT creditable as dollars", () => {
    expect(credit({ rewardType: "points", onChainId: 1, escrowTxHash: REAL })).toBe(false);
  });

  it("rewardType usdc + onChainId + a real escrow tx IS creditable", () => {
    expect(credit({ rewardType: "usdc", onChainId: 1, escrowTxHash: REAL })).toBe(true);
  });

  it("the placeholder that fooled the OLD signal is caught by the new one", () => {
    const task = { rewardType: "usdc", onChainId: null as number | null, escrowTxHash: "funded" };
    const oldLoose = task.onChainId !== null || !!task.escrowTxHash; // the pre-fix credit signal
    expect(oldLoose).toBe(true); // it WOULD have credited dollars
    expect(credit(task)).toBe(false); // it no longer does
  });

  it("isRealMoney alone is NOT enough — the reason hasOnChainEscrow exists", () => {
    const placeholder = { rewardType: "usdc" as const, onChainId: 1, escrowTxHash: "funded" };
    expect(isRealMoney(placeholder)).toBe(true); // display signal says yes...
    expect(credit(placeholder)).toBe(false); // ...credit signal still says no
  });
});
