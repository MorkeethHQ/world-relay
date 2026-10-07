import { describe, it, expect } from "vitest";
import {
  openCampaignBalance,
  deposit,
  reserve,
  accrue,
  release,
  pay,
  refund,
  campaignBalances,
  assertBalanceInvariant,
  BalanceInvariantError,
  type CampaignBalance,
  type BalanceTransition,
  type DepositVerifier,
} from "@/lib/campaign-balance";
import { usdcTextToUnits, usdcUnitsToText } from "@/lib/reward";

// TEST DATA ONLY. Every hash, reviewer and amount in this file is a labelled test
// value. None is a real deposit, a real person or a real payout. The verifier
// here is a test double: no network is touched.
const b = (n: number | string) => BigInt(n);
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const DEADLINE = 1_000_000;
const BEFORE = 1000;
const AFTER = DEADLINE + 1;

const confirms = (units: bigint): DepositVerifier => async () => ({ status: "confirmed", units });

function must(t: BalanceTransition): CampaignBalance {
  if (!t.ok) throw new Error(`expected ok, got ${t.reason}`);
  return t.state;
}
function reason(t: BalanceTransition): string {
  if (t.ok) throw new Error("expected a refusal, got ok");
  return t.reason;
}
// The rule, computed by the test and not by the module under test.
function adds(s: CampaignBalance): boolean {
  return s.available + s.committed + s.paid + s.refundable === s.deposited;
}
const fresh = () => openCampaignBalance({ campaignId: "test-campaign", deadline: DEADLINE });
async function funded(units: string = "1000000") {
  return must(await deposit(fresh(), { txHash: hash(1) }, confirms(b(units)), BEFORE));
}
const success = (reference: string, units: bigint) => ({ status: "success" as const, reference, units });

describe("campaign balance: empty", () => {
  it("opens with every figure at zero and the rule holding", () => {
    const s = fresh();
    expect(campaignBalances(s)).toEqual({ deposited: b(0), available: b(0), committed: b(0), paid: b(0), refundable: b(0) });
    expect(adds(s)).toBe(true);
    expect(s.version).toBe(0);
  });

  it("cannot reserve from an empty balance", () => {
    expect(reason(reserve(fresh(), { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE))).toBe("insufficient_available");
  });
});

describe("campaign balance: a deposit counts only when verified", () => {
  it("credits the amount the verifier read, into available", async () => {
    const s = await funded("250000");
    expect(s.deposited).toBe(b(250000));
    expect(s.available).toBe(s.deposited);
    expect(adds(s)).toBe(true);
    expect(s.version).toBe(1);
  });

  it.each(["funded", "", "0xdeadbeef", "0x" + "g".repeat(64), "0x" + "a".repeat(63), "0x" + "a".repeat(65), "a".repeat(66)])(
    "refuses %j before the verifier is asked, even when the verifier says yes to everything",
    async (txHash) => {
      let asked = 0;
      const yes: DepositVerifier = async () => {
        asked++;
        return { status: "confirmed", units: b(1000000) };
      };
      const s0 = fresh();
      const t = await deposit(s0, { txHash }, yes, BEFORE);
      expect(reason(t)).toBe("not_a_transaction_hash");
      expect(asked).toBe(0);
      expect(t.state).toBe(s0);
      expect(t.state.deposited).toBe(b(0));
    },
  );

  it("refuses a real-looking hash the verifier does not confirm", async () => {
    const s0 = fresh();
    expect(reason(await deposit(s0, { txHash: hash(1) }, async () => ({ status: "not_confirmed" }), BEFORE))).toBe("deposit_not_confirmed");
    expect(reason(await deposit(s0, { txHash: hash(1) }, async () => ({ status: "unknown" }), BEFORE))).toBe("deposit_unknown");
    expect(
      reason(
        await deposit(s0, { txHash: hash(1) }, async () => {
          throw new Error("test: endpoint down");
        }, BEFORE),
      ),
    ).toBe("verifier_failed");
    expect(s0.deposited).toBe(b(0));
  });

  it("refuses a confirmed deposit of zero, of a negative amount, and of a float", async () => {
    const s0 = fresh();
    expect(reason(await deposit(s0, { txHash: hash(1) }, confirms(b(0)), BEFORE))).toBe("invalid_amount");
    expect(reason(await deposit(s0, { txHash: hash(1) }, confirms(b(-5)), BEFORE))).toBe("invalid_amount");
    expect(reason(await deposit(s0, { txHash: hash(1) }, confirms(0.5 as unknown as bigint), BEFORE))).toBe("invalid_amount");
  });

  it("counts the same hash once, in any letter case, and does not ask the chain again", async () => {
    const upper = "0x" + "AB".repeat(32);
    let asked = 0;
    const v: DepositVerifier = async () => {
      asked++;
      return { status: "confirmed", units: b(500000) };
    };
    const s1 = must(await deposit(fresh(), { txHash: upper }, v, BEFORE));
    const again = await deposit(s1, { txHash: upper.toLowerCase() }, v, BEFORE);
    expect(again.ok && again.changed).toBe(false);
    expect(again.state).toBe(s1);
    expect(again.state.deposited).toBe(b(500000));
    expect(asked).toBe(1);
  });

  it("adds a second, different deposit", async () => {
    const s1 = await funded("500000");
    const s2 = must(await deposit(s1, { txHash: hash(2) }, confirms(b(1)), BEFORE));
    expect(s2.deposited).toBe(b(500001));
    expect(s2.available).toBe(b(500001));
  });

  it("puts a deposit that arrives after the deadline straight into refundable", async () => {
    const s = must(await deposit(fresh(), { txHash: hash(1) }, confirms(b(700)), AFTER));
    expect(s.available).toBe(b(0));
    expect(s.refundable).toBe(b(700));
    expect(adds(s)).toBe(true);
  });
});

describe("campaign balance: a reservation is all or nothing", () => {
  it("moves the units from available to committed", async () => {
    const s0 = await funded("10000");
    const s1 = must(reserve(s0, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
    expect(s1.available).toBe(s0.available - b(1000));
    expect(s1.committed).toBe(b(1000));
    expect(s1.contributions.c1.status).toBe("reserved");
    expect(adds(s1)).toBe(true);
  });

  it("refuses the whole reservation when available is 1 unit short, and changes nothing", async () => {
    const s0 = await funded("999");
    const t = reserve(s0, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE);
    expect(reason(t)).toBe("insufficient_available");
    expect(t.state).toBe(s0);
    expect(s0.available).toBe(b(999));
    expect(s0.committed).toBe(b(0));
    expect(Object.keys(s0.contributions)).toEqual([]);
  });

  it("lets the last unit be reserved and then refuses the next", async () => {
    let s = await funded("3000");
    for (const id of ["c1", "c2", "c3"]) s = must(reserve(s, { contributionId: id, reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
    expect(s.available).toBe(b(0));
    expect(reason(reserve(s, { contributionId: "c4", reviewer: "test-reviewer-a", units: b(1) }, BEFORE))).toBe("insufficient_available");
  });

  it("treats the same reservation again as a replay, and a different one under the same id as a conflict", async () => {
    const s1 = must(reserve(await funded("10000"), { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
    const again = reserve(s1, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE);
    expect(again.ok && again.changed).toBe(false);
    expect(again.state).toBe(s1);
    expect(reason(reserve(s1, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(2000) }, BEFORE))).toBe("id_conflict");
    expect(reason(reserve(s1, { contributionId: "c1", reviewer: "test-reviewer-b", units: b(1000) }, BEFORE))).toBe("id_conflict");
    expect(s1.committed).toBe(b(1000));
  });

  it("refuses zero, negative and float amounts, and empty ids", async () => {
    const s = await funded("10000");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: b(0) }, BEFORE))).toBe("invalid_amount");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: b(-1) }, BEFORE))).toBe("invalid_amount");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: 1000 as unknown as bigint }, BEFORE))).toBe("invalid_amount");
    expect(reason(reserve(s, { contributionId: "", reviewer: "r", units: b(1) }, BEFORE))).toBe("invalid_id");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "", units: b(1) }, BEFORE))).toBe("invalid_id");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1) }, NaN))).toBe("invalid_time");
  });

  it("refuses a new reservation at or after the deadline", async () => {
    const s = await funded("10000");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1) }, DEADLINE))).toBe("past_deadline");
    expect(reason(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1) }, AFTER))).toBe("past_deadline");
  });

  it("handles ids that are property names on every object", async () => {
    let s = await funded("10000");
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(reason(accrue(s, { contributionId: id, units: b(10) }))).toBe("not_reserved");
      s = must(reserve(s, { contributionId: id, reviewer: "test-reviewer-a", units: b(10) }, BEFORE));
      s = must(accrue(s, { contributionId: id, units: b(10) }));
    }
    expect(s.committed).toBe(b(40));
    expect(adds(s)).toBe(true);
  });

  it("never mutates the state it was given", async () => {
    const s0 = await funded("10000");
    const s1 = must(reserve(s0, { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    expect(s0.available).toBe(b(10000));
    expect(s0.contributions).toEqual({});
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.contributions)).toBe(true);
    expect(() => {
      (s1 as { available: bigint }).available = b(999999);
    }).toThrow(TypeError);
  });
});

describe("campaign balance: accrual is a compare-and-set on the contribution id", () => {
  async function reserved() {
    return must(reserve(await funded("10000"), { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
  }

  it("marks a reserved contribution earned and moves no balance", async () => {
    const s1 = await reserved();
    const s2 = must(accrue(s1, { contributionId: "c1", units: b(1000) }));
    expect(s2.contributions.c1.status).toBe("earned");
    expect(campaignBalances(s2)).toEqual(campaignBalances(s1));
  });

  it("changes nothing when the same accrual is replayed, any number of times", async () => {
    const s2 = must(accrue(await reserved(), { contributionId: "c1", units: b(1000) }));
    let s = s2;
    for (let i = 0; i < 50; i++) {
      const t = accrue(s, { contributionId: "c1", units: b(1000) });
      expect(t.ok && t.changed).toBe(false);
      s = t.state;
    }
    expect(s).toBe(s2);
    expect(s.committed).toBe(b(1000));
    expect(s.version).toBe(s2.version);
  });

  it("refuses a different amount under the same id, before and after it is earned", async () => {
    const s1 = await reserved();
    expect(reason(accrue(s1, { contributionId: "c1", units: b(1001) }))).toBe("amount_mismatch");
    const s2 = must(accrue(s1, { contributionId: "c1", units: b(1000) }));
    expect(reason(accrue(s2, { contributionId: "c1", units: b(5000) }))).toBe("amount_mismatch");
    expect(s2.committed).toBe(b(1000));
  });

  it("refuses an accrual with no reservation behind it", async () => {
    expect(reason(accrue(await funded("10000"), { contributionId: "never-reserved", units: b(1000) }))).toBe("not_reserved");
  });

  it("accrues the same units for a negative review as for a positive one", async () => {
    // Two labelled test reviews. The tone is test input, and the amount function
    // has no way to receive it.
    const reviews = [
      { id: "review-positive", reviewer: "test-reviewer-a", tone: "positive" },
      { id: "review-negative", reviewer: "test-reviewer-b", tone: "negative" },
    ];
    let s = await funded("10000");
    for (const r of reviews) {
      s = must(reserve(s, { contributionId: r.id, reviewer: r.reviewer, units: b(1000) }, BEFORE));
      s = must(accrue(s, { contributionId: r.id, units: b(1000) }));
    }
    expect(s.contributions["review-negative"].units).toBe(s.contributions["review-positive"].units);
    expect(s.contributions["review-negative"].status).toBe("earned");

    // A caller that tries to pass a tone does not compile...
    // @ts-expect-error sentiment is not a parameter of accrue
    accrue(s, { contributionId: "review-negative", units: b(1000), sentiment: "negative" });
    // @ts-expect-error sentiment is not a parameter of reserve
    reserve(s, { contributionId: "x", reviewer: "y", units: b(1), sentiment: "negative" }, BEFORE);
    // ...and one that forces it through gets the same units anyway.
    const forced = { contributionId: "forced", reviewer: "test-reviewer-b", units: b(1000), sentiment: "negative", rating: 1 };
    const s2 = must(reserve(s, forced as never, BEFORE));
    expect(s2.contributions.forced.units).toBe(b(1000));
    expect(Object.keys(s2.contributions.forced).sort()).toEqual(["id", "reviewer", "status", "units"]);
  });
});

describe("campaign balance: release", () => {
  it("returns a reserved slot to available before the deadline", async () => {
    const s0 = await funded("10000");
    const s1 = must(reserve(s0, { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    const s2 = must(release(s1, { contributionId: "c1" }, BEFORE));
    expect(s2.available).toBe(s0.available);
    expect(s2.committed).toBe(b(0));
    const again = release(s2, { contributionId: "c1" }, BEFORE);
    expect(again.ok && again.changed).toBe(false);
    expect(again.state.available).toBe(s0.available);
  });

  it("refuses to release an earned contribution, and refuses to accrue or reserve a released one", async () => {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    s = must(reserve(s, { contributionId: "c2", reviewer: "r", units: b(1000) }, BEFORE));
    s = must(accrue(s, { contributionId: "c1", units: b(1000) }));
    expect(reason(release(s, { contributionId: "c1" }, BEFORE))).toBe("already_earned");
    s = must(release(s, { contributionId: "c2" }, BEFORE));
    expect(reason(accrue(s, { contributionId: "c2", units: b(1000) }))).toBe("released");
    expect(reason(reserve(s, { contributionId: "c2", reviewer: "r", units: b(1000) }, BEFORE))).toBe("released");
    expect(s.committed).toBe(b(1000));
  });
});

describe("campaign balance: paid means a success receipt", () => {
  async function earned() {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
    s = must(reserve(s, { contributionId: "c2", reviewer: "test-reviewer-a", units: b(2000) }, BEFORE));
    s = must(accrue(s, { contributionId: "c1", units: b(1000) }));
    s = must(accrue(s, { contributionId: "c2", units: b(2000) }));
    return s;
  }
  const REF = hash(900);

  it("moves committed to paid for the exact batch amount", async () => {
    const s0 = await earned();
    const s1 = must(pay(s0, { contributionIds: ["c1", "c2"], receipt: success(REF, b(3000)) }));
    expect(s1.paid).toBe(b(3000));
    expect(s1.committed).toBe(s0.committed - b(3000));
    expect(s1.contributions.c1.status).toBe("paid");
    expect(s1.contributions.c1.paidReference).toBe(REF);
    expect(adds(s1)).toBe(true);
  });

  it("pays once when the same receipt is replayed", async () => {
    const s1 = must(pay(await earned(), { contributionIds: ["c1", "c2"], receipt: success(REF, b(3000)) }));
    let s = s1;
    for (let i = 0; i < 20; i++) {
      const t = pay(s, { contributionIds: ["c1", "c2"], receipt: success(REF, b(3000)) });
      expect(t.ok && t.changed).toBe(false);
      s = t.state;
    }
    expect(s).toBe(s1);
    expect(s.paid).toBe(b(3000));
  });

  it("refuses a second, different receipt for a contribution that is already paid", async () => {
    const s1 = must(pay(await earned(), { contributionIds: ["c1", "c2"], receipt: success(REF, b(3000)) }));
    expect(reason(pay(s1, { contributionIds: ["c1", "c2"], receipt: success(hash(901), b(3000)) }))).toBe("already_paid");
    expect(s1.paid).toBe(b(3000));
  });

  it("refuses one transfer that claims to pay two batches", async () => {
    const s1 = must(pay(await earned(), { contributionIds: ["c1"], receipt: success(REF, b(1000)) }));
    expect(reason(pay(s1, { contributionIds: ["c2"], receipt: success(REF, b(2000)) }))).toBe("reference_already_used");
    expect(s1.paid).toBe(b(1000));
  });

  it("refuses a batch that is partly paid already", async () => {
    const s1 = must(pay(await earned(), { contributionIds: ["c1"], receipt: success(REF, b(1000)) }));
    expect(reason(pay(s1, { contributionIds: ["c1", "c2"], receipt: success(REF, b(3000)) }))).toBe("batch_mismatch");
  });

  it.each([
    ["a pending receipt", { status: "pending", reference: REF, units: b(3000) }, "receipt_not_success"],
    ["a reverted receipt", { status: "reverted", reference: REF, units: b(3000) }, "receipt_not_success"],
    ["an unknown receipt", { status: "unknown", reference: REF, units: b(3000) }, "receipt_not_success"],
    ["no receipt", undefined, "receipt_not_success"],
    ["a placeholder reference", { status: "success", reference: "paid", units: b(3000) }, "not_a_transaction_hash"],
    ["a dry-run reference", { status: "success", reference: "dry-run:batch-1", units: b(3000) }, "not_a_transaction_hash"],
    ["a receipt 1 unit short", { status: "success", reference: REF, units: b(2999) }, "receipt_amount_mismatch"],
    ["a receipt 1 unit over", { status: "success", reference: REF, units: b(3001) }, "receipt_amount_mismatch"],
    ["a float amount", { status: "success", reference: REF, units: 3000 }, "invalid_amount"],
  ])("refuses %s and leaves paid at zero", async (_n, receipt, expected) => {
    const s0 = await earned();
    const t = pay(s0, { contributionIds: ["c1", "c2"], receipt: receipt as never });
    expect(reason(t)).toBe(expected);
    expect(t.state).toBe(s0);
    expect(s0.paid).toBe(b(0));
  });

  it("refuses the campaign's own deposit hash as proof of a payout", async () => {
    const s0 = await earned();
    expect(reason(pay(s0, { contributionIds: ["c1"], receipt: success(hash(1), b(1000)) }))).toBe("reference_is_a_deposit");
  });

  it("refuses to pay a contribution that is only reserved, released, unknown, or listed twice", async () => {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    expect(reason(pay(s, { contributionIds: ["c1"], receipt: success(REF, b(1000)) }))).toBe("not_earned");
    expect(reason(pay(s, { contributionIds: ["nope"], receipt: success(REF, b(1000)) }))).toBe("not_reserved");
    expect(reason(pay(s, { contributionIds: [], receipt: success(REF, b(1000)) }))).toBe("nothing_to_pay");
    expect(reason(pay(s, { contributionIds: ["c1", "c1"], receipt: success(REF, b(2000)) }))).toBe("duplicate_contribution");
    s = must(release(s, { contributionId: "c1" }, BEFORE));
    expect(reason(pay(s, { contributionIds: ["c1"], receipt: success(REF, b(1000)) }))).toBe("released");
    expect(s.paid).toBe(b(0));
  });

  it("refuses one transfer to two different reviewers", async () => {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "c1", reviewer: "test-reviewer-a", units: b(1000) }, BEFORE));
    s = must(reserve(s, { contributionId: "c2", reviewer: "test-reviewer-b", units: b(1000) }, BEFORE));
    s = must(accrue(s, { contributionId: "c1", units: b(1000) }));
    s = must(accrue(s, { contributionId: "c2", units: b(1000) }));
    expect(reason(pay(s, { contributionIds: ["c1", "c2"], receipt: success(REF, b(2000)) }))).toBe("mixed_reviewers");
  });
});

describe("campaign balance: refund accounting after the deadline", () => {
  it("refuses before the deadline", async () => {
    expect(reason(refund(await funded("10000"), DEADLINE - 1))).toBe("before_deadline");
  });

  it("moves what nobody was promised to refundable and keeps promised units committed", async () => {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "earned", reviewer: "r", units: b(1000) }, BEFORE));
    s = must(reserve(s, { contributionId: "open", reviewer: "r", units: b(500) }, BEFORE));
    s = must(accrue(s, { contributionId: "earned", units: b(1000) }));
    const before = s;
    s = must(refund(s, DEADLINE));
    expect(s.available).toBe(b(0));
    expect(s.refundable).toBe(before.available);
    expect(s.committed).toBe(b(1500));
    expect(adds(s)).toBe(true);
    // A second refund changes nothing.
    const again = refund(s, AFTER);
    expect(again.ok && again.changed).toBe(false);

    // The open reservation is released after the deadline: it goes to refundable.
    s = must(release(s, { contributionId: "open" }, AFTER));
    expect(s.refundable).toBe(before.available + b(500));
    expect(s.available).toBe(b(0));

    // The earned one can still be paid after the deadline.
    s = must(pay(s, { contributionIds: ["earned"], receipt: success(hash(77), b(1000)) }));
    expect(campaignBalances(s)).toEqual({ deposited: b(10000), available: b(0), committed: b(0), paid: b(1000), refundable: b(9000) });
  });

  it("lets a contribution reserved before the deadline be accrued after it", async () => {
    let s = await funded("10000");
    s = must(reserve(s, { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    s = must(refund(s, AFTER));
    s = must(accrue(s, { contributionId: "c1", units: b(1000) }));
    expect(s.contributions.c1.status).toBe("earned");
    expect(s.committed).toBe(b(1000));
  });
});

describe("campaign balance: the rule is enforced on every transition", () => {
  it("throws when handed a state that does not add up, whichever transition is called", async () => {
    const good = must(reserve(await funded("10000"), { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    const bad = { ...good, available: good.available + b(1) } as CampaignBalance;
    expect(adds(bad)).toBe(false);
    expect(() => assertBalanceInvariant(bad)).toThrow(BalanceInvariantError);
    expect(() => reserve(bad, { contributionId: "c2", reviewer: "r", units: b(1) }, BEFORE)).toThrow(BalanceInvariantError);
    expect(() => accrue(bad, { contributionId: "c1", units: b(1000) })).toThrow(BalanceInvariantError);
    expect(() => release(bad, { contributionId: "c1" }, BEFORE)).toThrow(BalanceInvariantError);
    expect(() => pay(bad, { contributionIds: ["c1"], receipt: success(hash(5), b(1000)) })).toThrow(BalanceInvariantError);
    expect(() => refund(bad, AFTER)).toThrow(BalanceInvariantError);
    expect(() => campaignBalances(bad)).toThrow(BalanceInvariantError);
    await expect(deposit(bad, { txHash: hash(2) }, confirms(b(1)), BEFORE)).rejects.toThrow(BalanceInvariantError);
  });

  it("catches a bucket that drifted from its records even when the four still add up", async () => {
    const good = must(reserve(await funded("10000"), { contributionId: "c1", reviewer: "r", units: b(1000) }, BEFORE));
    const shifted = { ...good, committed: good.committed - b(1), paid: good.paid + b(1) } as CampaignBalance;
    expect(adds(shifted)).toBe(true);
    expect(() => assertBalanceInvariant(shifted)).toThrow(/committed/);
  });

  it("catches a negative figure and a float figure", async () => {
    const good = await funded("10000");
    expect(() => assertBalanceInvariant({ ...good, available: b(-1), refundable: good.deposited + b(1) } as CampaignBalance)).toThrow(/negative/);
    expect(() => assertBalanceInvariant({ ...good, available: 10000 as unknown as bigint } as CampaignBalance)).toThrow(/not bigint/);
  });
});

describe("campaign balance: one thousand payments of 0.001 USDC", () => {
  it("reserves, accrues and pays 0.001 one thousand times and loses nothing", async () => {
    const step = usdcTextToUnits("0.001");
    let s = must(await deposit(fresh(), { txHash: hash(1) }, confirms(usdcTextToUnits("1")), BEFORE));
    for (let i = 0; i < 1000; i++) {
      const id = `c${i}`;
      s = must(reserve(s, { contributionId: id, reviewer: "test-reviewer-a", units: step }, BEFORE));
      s = must(accrue(s, { contributionId: id, units: step }));
      s = must(pay(s, { contributionIds: [id], receipt: success(hash(10_000 + i), step) }));
      expect(adds(s)).toBe(true);
    }
    expect(usdcUnitsToText(s.paid)).toBe("1");
    expect(s.paid).toBe(s.deposited);
    expect(s.available).toBe(b(0));
    expect(s.committed).toBe(b(0));
    // The budget is spent to the unit: one more 0.000001 is refused.
    expect(reason(reserve(s, { contributionId: "one-more", reviewer: "test-reviewer-a", units: b(1) }, BEFORE))).toBe("insufficient_available");
  });
});
