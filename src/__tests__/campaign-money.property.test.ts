import { describe, it, expect } from "vitest";
import {
  openCampaignBalance,
  deposit,
  reserve,
  accrue,
  release,
  refund,
  BalanceInvariantError,
  type CampaignBalance,
  type BalanceTransition,
} from "@/lib/campaign-balance";
import {
  openPaymentRecord,
  planPayouts,
  runPayout,
  resolvePendingPayouts,
  reviewerTotals,
  makeReceiptReader,
  ReferenceNotSavedError,
  type PaymentRecord,
  type PayoutSender,
  type ReceiptAnswer,
  type SettlementDeps,
} from "@/lib/campaign-settlement";
import { sumUsdcUnits, usdcTextToUnits, usdcUnitsToText } from "@/lib/reward";

// PROPERTY TESTS for the campaign money core. Random sequences of deposit,
// reserve, accrue, release, pay and refund, against a test chain that lives in
// this file. No network. Every identity and amount is a labelled test value.
//
// REPLAY A FAILURE. Every failure message carries the seed and the sequence.
//   FAVOUR_PROP_SEED=<seed> FAVOUR_PROP_RUNS=1 npx vitest run src/__tests__/campaign-money.property.test.ts
// FAVOUR_PROP_STEPS changes the length of each sequence.
//
// The checks below are computed by this file from its own tally. They do not
// call the module's own assertion, so they still mean something if that
// assertion is removed.
const BASE_SEED = Number(process.env.FAVOUR_PROP_SEED ?? 20261008);
const RUNS = Number(process.env.FAVOUR_PROP_RUNS ?? 200);
const STEPS = Number(process.env.FAVOUR_PROP_STEPS ?? 160);

const b = (n: number | string) => BigInt(n);
const ZERO = b(0);
const DEADLINE = 1_000_000;
const THRESHOLD = b(3000);
const REVIEWERS = ["test-reviewer-a", "test-reviewer-b", "test-reviewer-c"];

// mulberry32: a small seeded generator. The same seed gives the same sequence.
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p,
  };
}

type Fate = "success" | "reverted";
type RunResult = { ops: number; paid: bigint; transfers: number; reached: Record<string, number> };
type TestTransfer = { reference: string; payoutId: string; reviewer: string; units: bigint; contributionIds: readonly string[]; fate: Fate };

// One random run. Returns nothing; throws with the seed and the log on any break.
// `tamperAt` exists to prove the checks can fail: at that step the balance is
// replaced by one that is 1 unit off before the checks run.
async function run(seed: number, steps: number, tamperAt = -1): Promise<RunResult> {
  const rnd = prng(seed);
  const log: string[] = [];
  // Which paths this run really took. The suite asserts none of them is empty.
  const reached: Record<string, number> = {};
  const hit = (name: string) => {
    reached[name] = (reached[name] ?? 0) + 1;
  };
  const fail = (what: string): never => {
    throw new Error(`${what}\nseed ${seed}, step ${log.length}\nreplay: FAVOUR_PROP_SEED=${seed} FAVOUR_PROP_RUNS=1\nsequence:\n${log.join("\n")}`);
  };

  // THE TEST CHAIN. What "really" happened, independent of the record.
  const confirmedDeposits = new Map<string, bigint>(); // lower-case hash -> units
  const transfers: TestTransfer[] = [];
  let sends = 0;
  let hashCounter = 1;
  const newHash = () => "0x" + (hashCounter++).toString(16).padStart(64, "0");
  // When true, both endpoints tell the whole truth (used for the final drain).
  let noGaps = false;

  const sender: PayoutSender = {
    send: async (i) => {
      sends++;
      const mode = rnd.int(1, 20);
      if (mode === 1) return { status: "not_sent", reason: "test: refused before broadcast" };
      const t: TestTransfer = {
        reference: newHash(),
        payoutId: i.payoutId,
        reviewer: i.reviewer,
        units: i.units,
        contributionIds: i.contributionIds,
        fate: rnd.chance(0.2) ? "reverted" : "success",
      };
      transfers.push(t);
      // The transfer went out and the answer was lost.
      if (mode === 2) throw new Error("test: sender timed out after broadcast");
      return { status: "sent", reference: t.reference };
    },
  };
  const truth = (reference: string): ReceiptAnswer => {
    const t = transfers.find((x) => x.reference === reference);
    if (!t) return { status: "unknown" };
    return t.fate === "success" ? { status: "success", units: t.units } : { status: "reverted" };
  };
  const endpoint = (name: string, gap: number) => ({
    name,
    read: async (reference: string): Promise<ReceiptAnswer> => {
      if (!noGaps && rnd.chance(gap)) {
        if (rnd.chance(0.3)) throw new Error("test: endpoint down");
        return { status: "unknown" };
      }
      return truth(reference);
    },
  });
  // THE TEST STORE. It keeps the last record that was saved. One save in a run
  // can be made to fail; after a failure the run continues from what the store
  // holds, which is what a real process would find on its next start.
  let failSaveAt = 0;
  let saveCalls = 0;
  let lastSaved: PaymentRecord | null = null;
  const deps: SettlementDeps = {
    sender,
    readReceipt: makeReceiptReader([endpoint("test-endpoint-1", 0.5), endpoint("test-endpoint-2", 0.3)]),
    thresholdUnits: THRESHOLD,
    save: async (next) => {
      saveCalls++;
      if (saveCalls === failSaveAt) throw new Error("test: store did not answer");
      lastSaved = next;
    },
  };
  const armStore = (failAt: number) => {
    failSaveAt = failAt;
    saveCalls = 0;
    lastSaved = null;
  };

  let now = 1000;
  let nextContribution = 1;
  let record: PaymentRecord = openPaymentRecord(openCampaignBalance({ campaignId: "test-campaign", deadline: DEADLINE }));
  const setBalance = (state: CampaignBalance) => {
    record = { balance: state, settlement: record.settlement };
  };
  const ids = () => Object.keys(record.balance.contributions);

  const check = () => {
    const s = record.balance;
    for (const [name, v] of [["deposited", s.deposited], ["available", s.available], ["committed", s.committed], ["paid", s.paid], ["refundable", s.refundable]] as const) {
      if (typeof v !== "bigint") fail(`${name} is not a bigint`);
      if (v < ZERO) fail(`${name} went negative: ${v}`);
    }
    const total = s.available + s.committed + s.paid + s.refundable;
    if (total !== s.deposited) fail(`the four balances add to ${total}, deposited is ${s.deposited}`);
    // Deposited is exactly what the test chain confirmed. No unit made up, none lost.
    const chainDeposits = sumUsdcUnits([...confirmedDeposits.values()]);
    if (s.deposited !== chainDeposits) fail(`deposited ${s.deposited}, the test chain confirmed ${chainDeposits}`);
    // Paid never runs ahead of transfers that really succeeded.
    const succeeded = sumUsdcUnits(transfers.filter((t) => t.fate === "success").map((t) => t.units));
    if (s.paid > succeeded) fail(`paid ${s.paid} is more than the ${succeeded} that really arrived`);
    // No contribution is in two transfers that could both arrive.
    const seen = new Map<string, string>();
    for (const t of transfers) {
      if (t.fate === "reverted") continue;
      for (const id of t.contributionIds) {
        if (seen.has(id)) fail(`contribution ${id} was sent twice: ${seen.get(id)} and ${t.reference}`);
        seen.set(id, t.reference);
      }
    }
    // What reviewers read adds up to what is committed and paid, minus open reservations.
    let reviewerSide = ZERO;
    for (const r of REVIEWERS) {
      const t = reviewerTotals(record, r);
      reviewerSide += t.earned + t.pending + t.paid;
    }
    const reservedOnly = sumUsdcUnits(Object.values(s.contributions).filter((c) => c.status === "reserved").map((c) => c.units));
    if (reviewerSide + reservedOnly !== s.committed + s.paid) fail(`reviewer totals ${reviewerSide} plus reserved ${reservedOnly} do not match committed ${s.committed} plus paid ${s.paid}`);
  };

  const figures = (s: CampaignBalance) => [s.deposited, s.available, s.committed, s.paid, s.refundable].join("/");
  const apply = (label: string, t: BalanceTransition) => {
    log.push(`${label} -> ${t.ok ? (t.changed ? "ok" : "replay") : t.reason}`);
    hit(`${label.split(" ")[0]}:${t.ok ? (t.changed ? "ok" : "replay") : t.reason}`);
    if (!t.ok && t.state !== record.balance) fail("a refused transition returned a different state");
    if (t.ok && !t.changed && t.state !== record.balance) fail("a replay returned a different state");
    setBalance(t.state);
  };

  for (let step = 0; step < steps; step++) {
    // On average the deadline passes about three quarters of the way through.
    now += rnd.int(0, Math.floor((DEADLINE * 2.6) / Math.max(steps, 1)));
    const op = rnd.int(1, 100);

    // One operation. A `return` here means the operation had nothing to act on;
    // the tamper control and the checks below still run for the step.
    await (async () => {
    if (op <= 12) {
      // DEPOSIT: confirmed, unconfirmed, a placeholder, or a replay of an earlier one.
      const kind = rnd.int(1, 10);
      const before = record.balance.deposited;
      if (kind <= 5) {
        const txHash = newHash();
        const units = b(rnd.int(1, 20000));
        const t = await deposit(record.balance, { txHash }, async () => ({ status: "confirmed", units }), now);
        if (t.ok && t.changed) confirmedDeposits.set(txHash.toLowerCase(), units);
        apply(`deposit ${units} t=${now}`, t);
      } else if (kind <= 7) {
        const verdict = rnd.chance(0.5) ? ({ status: "not_confirmed" } as const) : ({ status: "unknown" } as const);
        apply(`deposit unconfirmed (${verdict.status})`, await deposit(record.balance, { txHash: newHash() }, async () => verdict, now));
        if (record.balance.deposited !== before) fail("an unconfirmed deposit changed deposited");
      } else if (kind === 8) {
        const placeholder = rnd.pick(["funded", "0xdeadbeef", "", "paid"]);
        apply(`deposit placeholder ${JSON.stringify(placeholder)}`, await deposit(record.balance, { txHash: placeholder }, async () => ({ status: "confirmed", units: b(999999) }), now));
        if (record.balance.deposited !== before) fail("a placeholder hash changed deposited");
      } else if (confirmedDeposits.size > 0) {
        const txHash = rnd.pick([...confirmedDeposits.keys()]);
        apply(`deposit replay`, await deposit(record.balance, { txHash: txHash.toUpperCase().replace("0X", "0x") }, async () => ({ status: "confirmed", units: b(777) }), now));
        if (record.balance.deposited !== before) fail("a replayed deposit was counted twice");
      }
    } else if (op <= 37) {
      // RESERVE: usually fits, sometimes larger than what is available.
      const units = rnd.chance(0.15) ? record.balance.available + b(rnd.int(1, 5)) : b(rnd.int(1, 4000));
      const id = `c${nextContribution++}`;
      const availableBefore = record.balance.available;
      apply(`reserve ${id} ${units} t=${now}`, reserve(record.balance, { contributionId: id, reviewer: rnd.pick(REVIEWERS), units }, now));
      if (units > availableBefore && record.balance.contributions[id]) fail("a reservation larger than available was accepted");
    } else if (op <= 60) {
      // ACCRUE, then the same accrual again: the second one must change nothing.
      const all = ids();
      if (all.length === 0) return;
      const c = record.balance.contributions[rnd.pick(all)];
      const units = rnd.chance(0.1) ? c.units + b(1) : c.units;
      apply(`accrue ${c.id} ${units}`, accrue(record.balance, { contributionId: c.id, units }));
      const before = record.balance;
      apply(`accrue ${c.id} ${units} (replay)`, accrue(record.balance, { contributionId: c.id, units }));
      if (record.balance !== before || figures(record.balance) !== figures(before)) fail("a replayed accrual changed the balances");
    } else if (op <= 68) {
      const all = ids();
      if (all.length === 0) return;
      const id = rnd.pick(all);
      apply(`release ${id} t=${now}`, release(record.balance, { contributionId: id }, now));
    } else if (op <= 86) {
      // PAY: plan, run one payout, then run the same plan again.
      const plans = planPayouts(record, { thresholdUnits: THRESHOLD });
      if (plans.length === 0) {
        log.push("pay: nothing to plan");
        return;
      }
      const plan = rnd.pick(plans);
      // About one run in ten loses a save: the first, the second or the third.
      armStore(rnd.chance(0.1) ? rnd.int(1, 3) : 0);
      const sendsBefore = sends;
      try {
        const out = await runPayout(deps, record, plan);
        log.push(`pay ${plan.id} ${plan.units} -> ${out.outcome}`);
        hit(`pay:${out.outcome}`);
        record = out.record;
      } catch (err) {
        const lostReference = err instanceof ReferenceNotSavedError;
        const lostSave = err instanceof Error && err.message === "test: store did not answer";
        if (!lostReference && !lostSave) throw err;
        log.push(`pay ${plan.id} ${plan.units} -> save ${failSaveAt} failed${lostReference ? ", the reference was not saved" : ""}`);
        hit(`pay:save_${failSaveAt}_failed`);
        if (failSaveAt === 1 && sends !== sendsBefore) fail("a transfer was sent although the payout was not saved first");
        if (lastSaved) record = lastSaved;
      }
      armStore(0);
      const onRecord = own(record.settlement.payouts, plan.id) !== undefined;
      const sendsAfter = sends;
      const again = await runPayout(deps, record, plan);
      log.push(`pay ${plan.id} (replay) -> ${again.outcome}`);
      hit(`pay_again:${again.outcome}`);
      record = again.record;
      if (onRecord && again.outcome !== "replay") fail("a payout already on the record was not treated as a replay");
      if (onRecord && sends !== sendsAfter) fail("a payout already on the record was sent again");
    } else if (op <= 94) {
      const paidBefore = record.balance.paid;
      const sendsBefore = sends;
      armStore(rnd.chance(0.1) ? 1 : 0);
      try {
        const res = await resolvePendingPayouts(deps, record);
        log.push(`resolve -> ${res.outcomes.map((o) => o.result.outcome).join(",") || "none"}; needs a person: ${res.needsOperator.length}`);
        for (const o of res.outcomes) hit(`resolve:${o.result.outcome}`);
        if (res.needsOperator.length > 0) hit("resolve:needs_a_person");
        record = res.record;
      } catch (err) {
        if (!(err instanceof Error && err.message === "test: store did not answer")) throw err;
        log.push("resolve -> a save failed, the record stays as stored");
      }
      armStore(0);
      if (sends !== sendsBefore) fail("resolving pending payouts sent a transfer");
      if (record.balance.paid < paidBefore) fail("paid went down");
    } else if (op <= 98) {
      apply(`refund t=${now}`, refund(record.balance, now));
    } else {
      // A state that is off by one unit must be refused by every transition.
      const s = record.balance;
      const field = rnd.pick(["available", "committed", "paid", "refundable", "deposited"] as const);
      const bad = { ...s, [field]: s[field] + b(1) } as CampaignBalance;
      log.push(`corrupt ${field} by 1 unit (must throw)`);
      hit("corrupt:refused");
      let threw = false;
      try {
        reserve(bad, { contributionId: "corrupt-probe", reviewer: REVIEWERS[0], units: b(1) }, now);
      } catch (err) {
        threw = err instanceof BalanceInvariantError;
      }
      if (!threw) fail(`a state with ${field} off by 1 unit was accepted by reserve`);
      threw = false;
      try {
        refund(bad, DEADLINE + 1);
      } catch (err) {
        threw = err instanceof BalanceInvariantError;
      }
      if (!threw) fail(`a state with ${field} off by 1 unit was accepted by refund`);
    }
    })();
    if (step === tamperAt) {
      log.push("TAMPER: available moved by 1 unit, on purpose");
      record = { balance: { ...record.balance, available: record.balance.available + b(1) }, settlement: record.settlement };
    }
    check();
  }

  // DRAIN. The endpoints stop having gaps. Everything with a reference resolves.
  noGaps = true;
  for (let i = 0; i < 3; i++) {
    record = (await resolvePendingPayouts(deps, record)).record;
    check();
  }
  // Every transfer that really succeeded AND whose reference the record holds
  // now reads paid, to the unit. (A transfer whose answer was lost has no
  // reference on the record: it waits for a person and is never sent again.)
  const known = new Set(Object.values(record.settlement.payouts).map((p) => p.reference));
  const arrived = sumUsdcUnits(transfers.filter((t) => t.fate === "success" && known.has(t.reference)).map((t) => t.units));
  if (record.balance.paid !== arrived) fail(`after the drain paid is ${record.balance.paid}, transfers on record that arrived add to ${arrived}`);
  const s = record.balance;
  if (usdcTextToUnits(usdcUnitsToText(s.deposited)) !== s.deposited) fail("deposited does not survive the text round trip");
  if (s.refundable > ZERO) hit("end:refundable_above_zero");
  return { ops: log.length, paid: s.paid, transfers: transfers.length, reached };
}

// A property that never takes a path proves nothing about it.
const MUST_REACH = [
  "deposit:ok", "deposit:replay", "deposit:deposit_not_confirmed", "deposit:deposit_unknown", "deposit:not_a_transaction_hash",
  "reserve:ok", "reserve:insufficient_available", "reserve:past_deadline",
  "accrue:ok", "accrue:replay", "accrue:amount_mismatch", "accrue:released",
  "release:ok", "release:replay", "release:already_earned",
  "refund:ok", "refund:before_deadline",
  "pay:paid", "pay:pending", "pay:retired", "pay:send_unconfirmed",
  "pay:save_1_failed", "pay:save_2_failed", "pay:save_3_failed",
  "pay_again:replay",
  "resolve:paid", "resolve:retired", "resolve:pending", "resolve:needs_a_person",
  "corrupt:refused", "end:refundable_above_zero",
];

const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

describe("campaign money: random sequences never break the balances", () => {
  it(`holds over ${RUNS} seeded sequences of ${STEPS} steps (base seed ${BASE_SEED})`, async () => {
    let ops = 0;
    let paid = ZERO;
    let transfers = 0;
    let runsThatPaid = 0;
    const reached: Record<string, number> = {};
    for (let i = 0; i < RUNS; i++) {
      const r = await run(BASE_SEED + i, STEPS);
      for (const [k, v] of Object.entries(r.reached)) reached[k] = (reached[k] ?? 0) + v;
      ops += r.ops;
      paid += r.paid;
      transfers += r.transfers;
      if (r.paid > ZERO) runsThatPaid++;
    }
    // The control: the generator really reached the paid path. A property that
    // never pays proves nothing about paying. Skipped for a single replayed seed.
    if (RUNS >= 20) {
      expect(ops).toBeGreaterThan(RUNS * STEPS * 0.8);
      expect(transfers).toBeGreaterThan(RUNS);
      expect(runsThatPaid).toBeGreaterThan(RUNS / 2);
      expect(paid).toBeGreaterThan(ZERO);
      for (const path of MUST_REACH) expect(reached[path] ?? 0, `the generator never reached ${path}`).toBeGreaterThan(0);
    }
    if (process.env.FAVOUR_PROP_REPORT) console.log(JSON.stringify({ runs: RUNS, steps: STEPS, ops, transfers, runsThatPaid, paidUnits: paid.toString(), reached }, null, 1));
  });

  it("gives the same result for the same seed, so a failure can be replayed", async () => {
    const first = await run(BASE_SEED, STEPS);
    const second = await run(BASE_SEED, STEPS);
    expect(second).toEqual(first);
    const other = await run(BASE_SEED + 7919, STEPS);
    expect(other).not.toEqual(first);
  });

  it("fails, with the seed and the sequence in the message, when a balance is 1 unit off", async () => {
    // The positive control for every check above: a run that is tampered with at
    // step 25 must go red, and the message must be enough to replay it.
    const seed = BASE_SEED + 3;
    const err = await run(seed, STEPS, 25).then(
      () => null,
      (e) => e as Error,
    );
    expect(err, "a tampered run passed").not.toBeNull();
    expect(err!.message).toContain("the four balances add to");
    expect(err!.message).toContain(`seed ${seed}`);
    expect(err!.message).toContain(`FAVOUR_PROP_SEED=${seed}`);
    expect(err!.message).toContain("TAMPER");
    // The sequence is in the message: the steps before the tamper, then the tamper, last.
    const sequence = err!.message.split("sequence:\n")[1].split("\n");
    expect(sequence[sequence.length - 1]).toContain("TAMPER");
    expect(sequence.filter((line) => line.includes(" -> ")).length).toBeGreaterThan(0);
  });
});

describe("campaign money: 0.001 USDC through a 1000-step sequence", () => {
  it("accrues and pays 0.001 one thousand times through batched payouts and ends on exactly 1 USDC", async () => {
    const step = usdcTextToUnits("0.001");
    let s = openCampaignBalance({ campaignId: "test-campaign", deadline: DEADLINE });
    const first = await deposit(s, { txHash: "0x" + "1".repeat(64) }, async () => ({ status: "confirmed", units: usdcTextToUnits("1") }), 1);
    if (!first.ok) throw new Error(first.reason);
    s = first.state;
    let record = openPaymentRecord(s);
    let n = 0;
    const sent: bigint[] = [];
    const chain = new Map<string, bigint>();
    const deps: SettlementDeps = {
      sender: {
        send: async (i) => {
          const reference = "0x" + (++n).toString(16).padStart(64, "a");
          chain.set(reference, i.units);
          sent.push(i.units);
          return { status: "sent", reference };
        },
      },
      readReceipt: makeReceiptReader([
        { name: "test-endpoint-1", read: async () => ({ status: "unknown" }) },
        { name: "test-endpoint-2", read: async (ref) => ({ status: "success", units: chain.get(ref)! }) },
      ]),
      save: async () => {},
    };
    for (let i = 0; i < 1000; i++) {
      const id = `c${i}`;
      const r = reserve(record.balance, { contributionId: id, reviewer: REVIEWERS[0], units: step }, 2);
      if (!r.ok) throw new Error(`step ${i}: ${r.reason}`);
      const a = accrue(r.state, { contributionId: id, units: step });
      if (!a.ok) throw new Error(`step ${i}: ${a.reason}`);
      record = { balance: a.state, settlement: record.settlement };
      for (const plan of planPayouts(record)) record = (await runPayout(deps, record, plan)).record;
      const bal = record.balance;
      expect(bal.available + bal.committed + bal.paid + bal.refundable).toBe(bal.deposited);
    }
    // Default threshold 0.10 USDC: one hundred 0.001 payments per transfer, ten transfers.
    expect(sent).toHaveLength(10);
    expect(sumUsdcUnits(sent)).toBe(usdcTextToUnits("1"));
    expect(usdcUnitsToText(record.balance.paid)).toBe("1");
    expect(record.balance.paid).toBe(record.balance.deposited);
    expect(record.balance.available).toBe(ZERO);
    expect(record.balance.committed).toBe(ZERO);
    expect(reviewerTotals(record, REVIEWERS[0])).toEqual({ earned: ZERO, pending: ZERO, paid: usdcTextToUnits("1") });
  });
});
