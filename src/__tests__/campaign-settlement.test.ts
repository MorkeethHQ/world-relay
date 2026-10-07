import { describe, it, expect } from "vitest";
import { openCampaignBalance, deposit, reserve, accrue, type CampaignBalance, type BalanceTransition } from "@/lib/campaign-balance";
import {
  DEFAULT_PAYOUT_THRESHOLD_UNITS,
  MIN_RECEIPT_ENDPOINTS,
  openPaymentRecord,
  planPayouts,
  openPayout,
  attachReference,
  settlePayout,
  reviewerTotals,
  makeReceiptReader,
  makeDryRunSender,
  runPayout,
  resolvePendingPayouts,
  assertPaymentRecord,
  ReferenceNotSavedError,
  SettlementInvariantError,
  type PaymentRecord,
  type PayoutSender,
  type ReceiptAnswer,
  type ReceiptEndpoint,
  type ReceiptReading,
  type SettlementDeps,
} from "@/lib/campaign-settlement";
import { usdcTextToUnits } from "@/lib/reward";

// TEST DATA ONLY. Every hash, reviewer, endpoint and amount here is a labelled
// test value. The senders and endpoints are test doubles. No network is touched
// and nothing here is a real payout.
const b = (n: number | string) => BigInt(n);
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const DEADLINE = 1_000_000;
const NOW = 1000;
const A = "test-reviewer-a";
const B = "test-reviewer-b";

function must(t: BalanceTransition): CampaignBalance {
  if (!t.ok) throw new Error(`expected ok, got ${t.reason}`);
  return t.state;
}

// A record with `budget` units deposited and the given contributions earned.
async function recordWith(earned: Array<[id: string, reviewer: string, units: number]>, reservedOnly: Array<[string, string, number]> = []) {
  let s = openCampaignBalance({ campaignId: "test-campaign", deadline: DEADLINE });
  s = must(await deposit(s, { txHash: hash(1) }, async () => ({ status: "confirmed", units: usdcTextToUnits("5") }), NOW));
  for (const [id, reviewer, units] of earned) {
    s = must(reserve(s, { contributionId: id, reviewer, units: b(units) }, NOW));
    s = must(accrue(s, { contributionId: id, units: b(units) }));
  }
  for (const [id, reviewer, units] of reservedOnly) s = must(reserve(s, { contributionId: id, reviewer, units: b(units) }, NOW));
  return openPaymentRecord(s);
}

// A test harness that writes down every outside effect in order.
function harness(opts: {
  answers?: Array<ReceiptAnswer | Error>[]; // per endpoint, consumed one per read; the last one repeats
  senderThrows?: boolean;
  senderSaysNotSent?: boolean;
  failSaveAt?: number; // 1-based index of the save call that throws
  thresholdUnits?: bigint;
}) {
  const events: string[] = [];
  const saved: PaymentRecord[] = [];
  const sent: Array<{ payoutId: string; units: bigint; reviewer: string }> = [];
  let saves = 0;
  let nextRef = 5000;
  const sender: PayoutSender = {
    send: async (i) => {
      events.push("send");
      sent.push({ payoutId: i.payoutId, units: i.units, reviewer: i.reviewer });
      if (opts.senderThrows) throw new Error("test: sender timed out");
      if (opts.senderSaysNotSent) return { status: "not_sent", reason: "test: nothing left" };
      return { status: "sent", reference: hash(nextRef++) };
    },
  };
  const script = opts.answers ?? [[{ status: "unknown" }], [{ status: "unknown" }]];
  const endpoints: ReceiptEndpoint[] = script.map((list, i) => {
    let n = 0;
    return {
      name: `test-endpoint-${i + 1}`,
      read: async () => {
        events.push(`read:${i + 1}`);
        const a = list[Math.min(n++, list.length - 1)];
        if (a instanceof Error) throw a;
        return a;
      },
    };
  });
  const deps: SettlementDeps = {
    sender,
    readReceipt: makeReceiptReader(endpoints),
    thresholdUnits: opts.thresholdUnits,
    save: async (next) => {
      saves++;
      if (opts.failSaveAt === saves) {
        events.push("save:FAILED");
        throw new Error("test: store did not answer");
      }
      const p = Object.values(next.settlement.payouts).slice(-1)[0];
      events.push(`save:${p.status}:${p.reference === null ? "no-reference" : "reference"}`);
      saved.push(next);
    },
  };
  return { deps, events, saved, sent };
}

const ok = (units: number): ReceiptAnswer => ({ status: "success", units: b(units) });
const UNKNOWN: ReceiptAnswer = { status: "unknown" };
const REVERTED: ReceiptAnswer = { status: "reverted" };

describe("payout planning above a threshold", () => {
  it("has a default threshold of 100,000 units, which is 0.10 USDC", () => {
    expect(DEFAULT_PAYOUT_THRESHOLD_UNITS).toBe(usdcTextToUnits("0.1"));
  });

  it("plans nothing for an empty record", async () => {
    expect(planPayouts(await recordWith([]))).toEqual([]);
  });

  it("plans nothing 1 unit below the threshold and one payout exactly at it", async () => {
    const below = await recordWith([["c1", A, 60000], ["c2", A, 39999]]);
    expect(planPayouts(below)).toEqual([]);
    const at = await recordWith([["c1", A, 60000], ["c2", A, 40000]]);
    const plans = planPayouts(at);
    expect(plans).toHaveLength(1);
    expect(plans[0].units).toBe(DEFAULT_PAYOUT_THRESHOLD_UNITS);
    expect(plans[0].contributionIds).toEqual(["c1", "c2"]);
    expect(plans[0].attempt).toBe(1);
  });

  it("groups by reviewer and never adds two reviewers together to reach the threshold", async () => {
    const r = await recordWith([["c1", A, 60000], ["c2", B, 60000]]);
    expect(planPayouts(r)).toEqual([]);
    const plans = planPayouts(r, { thresholdUnits: b(60000) });
    expect(plans.map((p) => [p.reviewer, p.units])).toEqual([[A, b(60000)], [B, b(60000)]]);
  });

  it("counts earned units only: a reservation that is not accepted yet does not count", async () => {
    const r = await recordWith([["c1", A, 60000]], [["c2", A, 60000]]);
    expect(planPayouts(r)).toEqual([]);
  });

  it("gives the same plan and the same payout id for the same record", async () => {
    const r = await recordWith([["c2", A, 60000], ["c1", A, 60000]]);
    expect(planPayouts(r)).toEqual(planPayouts(r));
    expect(planPayouts(r)[0].id).toBe(JSON.stringify(["test-campaign", A, 1]));
  });

  it("refuses a threshold that is a float or not positive", async () => {
    const r = await recordWith([]);
    expect(() => planPayouts(r, { thresholdUnits: 0.1 as unknown as bigint })).toThrow(TypeError);
    expect(() => planPayouts(r, { thresholdUnits: b(0) })).toThrow(TypeError);
  });
});

describe("one payout: the order of the steps", () => {
  it("saves pending, sends once, saves the reference, and only then reads the receipt", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ answers: [[ok(100000)], [ok(100000)]] });
    const out = await runPayout(h.deps, r0, planPayouts(r0)[0]);

    expect(h.events).toEqual(["save:pending:no-reference", "send", "save:pending:reference", "read:1", "read:2", "save:paid:reference"]);
    // Position, stated as a relationship: the reference is saved before the first read.
    expect(h.events.indexOf("save:pending:reference")).toBeLessThan(h.events.indexOf("read:1"));
    expect(h.events.indexOf("save:pending:no-reference")).toBeLessThan(h.events.indexOf("send"));
    expect(out.outcome).toBe("paid");
    expect(out.record.balance.paid).toBe(r0.balance.committed);
    expect(out.record.balance.committed).toBe(b(0));
    expect(reviewerTotals(out.record, A)).toEqual({ earned: b(0), pending: b(0), paid: b(100000) });
  });

  it("sends nothing when the first save fails", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ failSaveAt: 1 });
    await expect(runPayout(h.deps, r0, planPayouts(r0)[0])).rejects.toThrow("store did not answer");
    expect(h.sent).toEqual([]);
    expect(h.events).toEqual(["save:FAILED"]);
  });

  it("raises the reference loudly when it was sent and could not be saved, and reads no receipt", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ failSaveAt: 2, answers: [[ok(100000)], [ok(100000)]] });
    const err = await runPayout(h.deps, r0, planPayouts(r0)[0]).catch((e) => e);
    expect(err).toBeInstanceOf(ReferenceNotSavedError);
    expect(err.reference).toBe(hash(5000));
    expect(err.message).toContain(hash(5000));
    expect(h.events).toEqual(["save:pending:no-reference", "send", "save:FAILED"]);
    // What the store holds is a pending payout with no reference. It is not sent again.
    const stored = h.saved[0];
    expect(planPayouts(stored)).toEqual([]);
    expect(stored.balance.paid).toBe(b(0));
  });
});

describe("paid means a success receipt", () => {
  it("stays pending when no endpoint knows the receipt, and reads pending to the reviewer", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({});
    const out = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(out.outcome).toBe("pending");
    expect(out.record.balance.paid).toBe(b(0));
    expect(out.record.balance.committed).toBe(b(100000));
    expect(reviewerTotals(out.record, A)).toEqual({ earned: b(0), pending: b(100000), paid: b(0) });
  });

  it("stays pending when the receipt shows a different amount, by 1 unit", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ answers: [[ok(99999)], [ok(99999)]] });
    const out = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(out).toMatchObject({ outcome: "pending", payRefused: "receipt_amount_mismatch" });
    expect(out.record.balance.paid).toBe(b(0));
  });

  it("retires the payout on a confirmed revert and the units read earned again", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ answers: [[REVERTED], [REVERTED]] });
    const out = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(out).toMatchObject({ outcome: "retired", because: "reverted" });
    expect(out.record.balance.paid).toBe(b(0));
    expect(reviewerTotals(out.record, A)).toEqual({ earned: b(100000), pending: b(0), paid: b(0) });
    // A new attempt is allowed, under a new id.
    const again = planPayouts(out.record);
    expect(again).toHaveLength(1);
    expect(again[0].attempt).toBe(2);
    expect(again[0].id).not.toBe(planPayouts(r0)[0].id);
  });

  it("retires the payout when the sender states that nothing was sent", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ senderSaysNotSent: true });
    const out = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(out).toMatchObject({ outcome: "retired", because: "not_sent" });
    expect(h.events).toEqual(["save:pending:no-reference", "send", "save:retired:no-reference"]);
    expect(reviewerTotals(out.record, A).earned).toBe(b(100000));
  });

  it("becomes paid on a later run when the receipt arrives, and sends nothing on that run", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ answers: [[UNKNOWN], [UNKNOWN, ok(100000)]] });
    const first = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(first.outcome).toBe("pending");
    const later = await resolvePendingPayouts(h.deps, first.record);
    expect(later.outcomes.map((o) => o.result.outcome)).toEqual(["paid"]);
    expect(later.record.balance.paid).toBe(b(100000));
    expect(h.sent).toHaveLength(1);
  });
});

describe("never pay twice, never send twice", () => {
  it("does not send again when the same plan is run a second time", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const h = harness({ answers: [[ok(100000)], [ok(100000)]] });
    const first = await runPayout(h.deps, r0, plan);
    const second = await runPayout(h.deps, first.record, plan);
    expect(second).toMatchObject({ outcome: "replay", status: "paid" });
    expect(second.record).toBe(first.record);
    expect(h.sent).toHaveLength(1);
    expect(second.record.balance.paid).toBe(plan.units);
  });

  it("does not pay again when the same receipt is applied a second time", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({ answers: [[ok(100000)], [ok(100000)]] });
    const first = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    const id = planPayouts(r0)[0].id;
    const reading: ReceiptReading = { status: "success", units: b(100000), asked: 2, answers: [] };
    const again = settlePayout(first.record, id, reading);
    expect(again.ok && again.changed).toBe(false);
    expect(again.record.balance.paid).toBe(b(100000));
    const later = await resolvePendingPayouts(h.deps, first.record);
    expect(later.outcomes).toEqual([]);
    expect(later.record).toBe(first.record);
  });

  it("plans nothing and refuses a hand-made plan while an earlier reference is unresolved", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const h = harness({});
    const first = await runPayout(h.deps, r0, planPayouts(r0)[0]);
    expect(first.outcome).toBe("pending");

    // The reviewer earns more while the first payout is unresolved.
    let s = first.record.balance;
    s = must(reserve(s, { contributionId: "c2", reviewer: A, units: b(200000) }, NOW));
    s = must(accrue(s, { contributionId: "c2", units: b(200000) }));
    const r1: PaymentRecord = { balance: s, settlement: first.record.settlement };
    expect(planPayouts(r1)).toEqual([]);
    const forced = { id: "forced", campaignId: "test-campaign", reviewer: A, contributionIds: ["c2"], units: b(200000), attempt: 2 };
    expect(await runPayout(h.deps, r1, forced)).toMatchObject({ outcome: "refused", reason: "unresolved_payout" });
    // The first contribution cannot be put in a second payout either.
    const dup = openPayout(r1, { ...forced, id: "dup", contributionIds: ["c1"], units: b(100000) });
    expect(dup.ok).toBe(false);
    expect(h.sent).toHaveLength(1);
    // Another reviewer is not blocked by it.
    expect(reviewerTotals(r1, A)).toEqual({ earned: b(200000), pending: b(100000), paid: b(0) });
  });

  it("does not send again after a sender that never answered", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const h = harness({ senderThrows: true });
    const out = await runPayout(h.deps, r0, plan);
    expect(out.outcome).toBe("send_unconfirmed");
    expect(out.record.settlement.payouts[plan.id]).toMatchObject({ status: "pending", reference: null });
    expect(h.events).toEqual(["save:pending:no-reference", "send"]);
    // Every later path leaves it alone and hands it to a person.
    expect(planPayouts(out.record)).toEqual([]);
    expect(await runPayout(h.deps, out.record, plan)).toMatchObject({ outcome: "replay", status: "pending" });
    const later = await resolvePendingPayouts(h.deps, out.record);
    expect(later.needsOperator).toEqual([plan.id]);
    expect(later.outcomes).toEqual([]);
    expect(h.sent).toHaveLength(1);
    expect(out.record.balance.paid).toBe(b(0));
  });

  it("keeps a payout pending when a sender claims sent with a reference that is not a transaction hash", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    let reads = 0;
    const out = await runPayout(
      {
        sender: { send: async () => ({ status: "sent", reference: "paid" }) },
        readReceipt: async () => {
          reads++;
          return { status: "success", units: b(100000), asked: 2, answers: [] };
        },
        save: async () => {},
      },
      r0,
      plan,
    );
    expect(out.outcome).toBe("send_unconfirmed");
    expect(reads).toBe(0);
    expect(out.record.settlement.payouts[plan.id]).toMatchObject({ status: "pending", reference: "paid" });
    expect(out.record.balance.paid).toBe(b(0));
    expect(planPayouts(out.record)).toEqual([]);
  });

  it("writes a reference once: the same one is a replay, another one is refused", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const opened = openPayout(r0, plan);
    if (!opened.ok) throw new Error(opened.reason);
    const first = attachReference(opened.record, plan.id, hash(7));
    if (!first.ok) throw new Error(first.reason);
    const again = attachReference(first.record, plan.id, hash(7));
    expect(again.ok && again.changed).toBe(false);
    const other = attachReference(first.record, plan.id, hash(8));
    expect(other).toMatchObject({ ok: false, reason: "reference_conflict" });
    expect(first.record.settlement.payouts[plan.id].reference).toBe(hash(7));
  });

  it("checks the plan against the record and trusts none of its numbers", async () => {
    const r0 = await recordWith([["c1", A, 100000]], [["c2", A, 100000]]);
    const plan = planPayouts(r0)[0];
    expect(openPayout(r0, { ...plan, units: plan.units + b(1) })).toMatchObject({ ok: false, reason: "plan_mismatch" });
    expect(openPayout(r0, { ...plan, contributionIds: ["c2"] })).toMatchObject({ ok: false, reason: "not_earned" });
    expect(openPayout(r0, { ...plan, contributionIds: ["nope"] })).toMatchObject({ ok: false, reason: "not_reserved" });
    expect(openPayout(r0, { ...plan, reviewer: B })).toMatchObject({ ok: false, reason: "mixed_reviewers" });
    expect(openPayout(r0, plan, { thresholdUnits: plan.units + b(1) })).toMatchObject({ ok: false, reason: "below_threshold" });
  });
});

describe("the receipt reader asks more than one endpoint", () => {
  const ep = (name: string, answer: ReceiptAnswer | Error, calls?: string[]): ReceiptEndpoint => ({
    name,
    read: async () => {
      calls?.push(name);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });

  it("cannot be built on fewer than two endpoints, or on the same endpoint twice", () => {
    expect(MIN_RECEIPT_ENDPOINTS).toBeGreaterThanOrEqual(2);
    expect(() => makeReceiptReader([])).toThrow(RangeError);
    expect(() => makeReceiptReader([ep("one", UNKNOWN)])).toThrow(RangeError);
    expect(() => makeReceiptReader([ep("one", UNKNOWN), ep("one", UNKNOWN)])).toThrow(RangeError);
  });

  it("finds a success the first endpoint has no record of (the measured 2026-10-08 case)", async () => {
    const calls: string[] = [];
    const read = makeReceiptReader([ep("has-a-gap", UNKNOWN, calls), ep("has-the-receipt", ok(950000), calls)]);
    const r = await read(hash(1));
    expect(r.status).toBe("success");
    expect(r.units).toBe(b(950000));
    expect(calls).toEqual(["has-a-gap", "has-the-receipt"]);
  });

  it("answers unknown only after asking every endpoint, and keeps each answer", async () => {
    const calls: string[] = [];
    const read = makeReceiptReader([ep("e1", UNKNOWN, calls), ep("e2", UNKNOWN, calls), ep("e3", UNKNOWN, calls)]);
    const r = await read(hash(1));
    expect(r.status).toBe("unknown");
    expect(r.asked).toBe(calls.length);
    expect(r.asked).toBeGreaterThanOrEqual(MIN_RECEIPT_ENDPOINTS);
    expect(r.answers.map((a) => a.endpoint)).toEqual(calls);
  });

  it("counts an endpoint that throws as unknown, keeps its error, and still asks the next one", async () => {
    const read = makeReceiptReader([ep("down", new Error("test: 503")), ep("up", ok(1000))]);
    const r = await read(hash(1));
    expect(r.status).toBe("success");
    expect(r.answers[0]).toEqual({ endpoint: "down", status: "unknown", error: "test: 503" });
    const both = await makeReceiptReader([ep("down", new Error("test: 503")), ep("blank", UNKNOWN)])(hash(1));
    expect(both.status).toBe("unknown");
    expect(both.asked).toBe(2);
  });

  it("does not believe one endpoint that says reverted", async () => {
    const one = await makeReceiptReader([ep("e1", REVERTED), ep("e2", UNKNOWN)])(hash(1));
    expect(one.status).toBe("unknown");
    const two = await makeReceiptReader([ep("e1", REVERTED), ep("e2", REVERTED)])(hash(1));
    expect(two.status).toBe("reverted");
  });

  it("answers unknown, marked as a conflict, when endpoints disagree", async () => {
    const mixed = await makeReceiptReader([ep("e1", ok(1000)), ep("e2", REVERTED)])(hash(1));
    expect(mixed).toMatchObject({ status: "unknown", conflict: true });
    const amounts = await makeReceiptReader([ep("e1", ok(1000)), ep("e2", ok(1001))])(hash(1));
    expect(amounts).toMatchObject({ status: "unknown", conflict: true });
  });

  it("does not count a success that carries no exact amount", async () => {
    const float = { status: "success", units: 1000 } as unknown as ReceiptAnswer;
    const r = await makeReceiptReader([ep("e1", float), ep("e2", UNKNOWN)])(hash(1));
    expect(r.status).toBe("unknown");
  });
});

describe("the dry-run sender sends nothing and can never produce paid", () => {
  it("records what it would send and leaves paid at zero", async () => {
    const r0 = await recordWith([["c1", A, 60000], ["c2", A, 40000], ["c3", B, 250000]]);
    const dry = makeDryRunSender();
    const reads: string[] = [];
    const deps: SettlementDeps = {
      sender: dry,
      readReceipt: async (ref) => {
        reads.push(ref);
        return { status: "success", units: b(100000), asked: 2, answers: [] };
      },
      save: async () => {},
    };
    let record = r0;
    const outcomes: string[] = [];
    for (const plan of planPayouts(r0)) {
      const out = await runPayout(deps, record, plan);
      outcomes.push(out.outcome);
      record = out.record;
    }
    expect(outcomes).toEqual(["dry_run", "dry_run"]);
    expect(dry.wouldSend.map((i) => [i.reviewer, i.units, i.contributionIds])).toEqual([
      [A, b(100000), ["c1", "c2"]],
      [B, b(250000), ["c3"]],
    ]);
    // The reader is never asked about a dry-run reference.
    expect(reads).toEqual([]);
    expect(record.balance.paid).toBe(b(0));
    expect(record.balance.committed).toBe(r0.balance.committed);
    for (const p of Object.values(record.settlement.payouts)) expect(p.reference).toMatch(/^dry-run:/);
  });

  it("refuses to mark a dry-run reference paid even when a reader claims success", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const out = await runPayout({ sender: makeDryRunSender(), readReceipt: async () => ({ status: "unknown", asked: 2, answers: [] }), save: async () => {} }, r0, plan);
    const forced = settlePayout(out.record, plan.id, { status: "success", units: b(100000), asked: 2, answers: [] });
    expect(forced).toMatchObject({ ok: false, reason: "not_a_transaction_hash" });
    expect(forced.record.balance.paid).toBe(b(0));
    const later = await resolvePendingPayouts({ readReceipt: async () => ({ status: "success", units: b(100000), asked: 2, answers: [] }), save: async () => {} }, out.record);
    expect(later.needsOperator).toEqual([plan.id]);
    expect(later.record.balance.paid).toBe(b(0));
  });
});

describe("the payouts must agree with the balances", () => {
  it("throws on a record whose payout reads paid while the balance does not", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const opened = openPayout(r0, plan);
    if (!opened.ok) throw new Error(opened.reason);
    const p = opened.record.settlement.payouts[plan.id];
    const lying: PaymentRecord = {
      balance: opened.record.balance,
      settlement: { version: 9, payouts: { [p.id]: { ...p, status: "paid", reference: hash(3) } } },
    };
    expect(() => assertPaymentRecord(lying)).toThrow(SettlementInvariantError);
    expect(() => planPayouts(lying)).toThrow(SettlementInvariantError);
    expect(() => reviewerTotals(lying, A)).toThrow(SettlementInvariantError);
  });

  it("throws on a contribution held by two live payouts", async () => {
    const r0 = await recordWith([["c1", A, 100000]]);
    const plan = planPayouts(r0)[0];
    const opened = openPayout(r0, plan);
    if (!opened.ok) throw new Error(opened.reason);
    const p = opened.record.settlement.payouts[plan.id];
    const twice: PaymentRecord = {
      balance: opened.record.balance,
      settlement: { version: 9, payouts: { [p.id]: p, second: { ...p, id: "second", reviewer: A } } },
    };
    expect(() => assertPaymentRecord(twice)).toThrow(SettlementInvariantError);
  });
});
