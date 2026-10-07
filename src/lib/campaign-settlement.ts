// CAMPAIGN SETTLEMENT (2026-10-08): from earned units to a paid reviewer.
//
// STATUS: a pure core plus one orchestrator whose every outside effect is
// injected. Nothing in src/app imports it. It ships no wallet client, no key, no
// env read, no network call and no cron. The only sender in this file is a
// dry-run sender that records what it would send. A real sender, the wallet it
// signs with and the switch are Oscar's.
//
// WHAT A REVIEWER SEES, three states, in bigint base units:
//   earned    the contribution was accepted and the units are set aside for it
//             (committed in campaign-balance.ts). Nothing has been sent.
//   pending   the contribution is in a payout whose transfer reference was saved
//             and whose receipt has not been read as a success yet.
//   paid      the transfer has a success receipt for the exact amount.
//
// WHY BATCHES. One 0.001 USDC transfer costs a large share of itself in gas
// (money study 2026-10-08, section 4, price unverified). Earned units wait until
// one reviewer's total reaches a threshold, then go out as one transfer.
//
// THE ORDER (the Inv 8 pattern, SECURITY-INVARIANTS):
//   1. The payout is saved as pending, with no reference, BEFORE anything is sent.
//   2. The sender is called once.
//   3. The reference is saved BEFORE any receipt is awaited.
//   4. The receipt reader is asked.
//   5. paid only on a success receipt. A definite revert retires the payout and
//      the units read earned again. Anything else stays pending.
// A reviewer with an unresolved payout gets no new payout. A payout that was
// saved but has no reference (the sender never answered) is never sent again by
// this code: nobody knows whether it went out, so a person must look.
//
// THE RECEIPT READER asks every endpoint it was given, and it must be given at
// least two. The reason is measured: on 2026-10-08 one public endpoint returned
// null for ten receipts that a second endpoint showed as successful transfers.
// A null from one endpoint is not "unpaid". "reverted" is the answer that
// permits a new transfer, so it needs two endpoints to agree and none to disagree.
//
// VOCABULARY DECISION, FLAGGED FOR OSCAR. PR 46 (draft, held, branch
// sun-0927/favour-campaign, src/lib/campaign-payouts-shape.ts) already names
// payout states for an accepted campaign piece. This file does not edit PR 46.
// The two vocabularies collide on one word, so one of them must win. Mapping:
//
//   PR 46 status / reason        here
//   pending / pool_unfunded      no state. With no verified deposit there is
//                                nothing to reserve, so nothing is earned. The
//                                reservation is refused: insufficient_available.
//   pending / awaiting_payout    earned.
//   paid                         paid, with a stricter test: PR 46 records a hash
//                                an operator typed into a script; here it is a
//                                success receipt for the exact amount.
//   failed / pool_exhausted      no state. A refused reservation
//                                (insufficient_available), decided before the
//                                reviewer is promised anything.
//   failed / payout_failed       the payout is retired and the units read earned
//                                again. A reviewer never reads "failed" for
//                                money that is still set aside for them.
//
// THE COLLISION: PR 46 "pending" means no money has moved. Here "pending" means
// a transfer was sent and its receipt is not in. The same word on one screen for
// both would tell a reviewer the opposite of the truth half the time.
// PROPOSAL, not a ruling: this file's three states win, and PR 46's `pending`
// rows are shown as earned (pool funded) or are not created (pool not funded).
// ALSO SUPERSEDED: PR 46 holds `amountUsdc: number` and splits a pool with float
// division. The bigint units in campaign-balance.ts replace that arithmetic.
//
// WHAT A STORE MUST ADD before this is wired: `save` below must be a
// compare-and-set against the record it was derived from, in one atomic script,
// so two runs cannot both pass step 1 for the same reviewer.

import { sumUsdcUnits } from "./reward";
import { pay, assertBalanceInvariant, type CampaignBalance, type BalanceRefusal } from "./campaign-balance";

const ZERO = BigInt(0);
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

// PROPOSAL, NOT OSCAR'S RULING. 100,000 units is 0.10 USDC, the figure the money
// study of 2026-10-08 (section 6) recommends. The minimum and maximum
// micro-payment are unruled. Every function takes the threshold as a parameter.
export const DEFAULT_PAYOUT_THRESHOLD_UNITS = BigInt(100_000);

// A real receipt reader needs at least this many independent endpoints.
export const MIN_RECEIPT_ENDPOINTS = 2;

export type ReviewerPaymentState = "earned" | "pending" | "paid";

// "retired" is a record-keeping status for a payout that did not happen (a
// definite revert, or a sender that said it sent nothing). It is not a state a
// reviewer sees: its contributions read earned again.
export type PayoutStatus = "pending" | "paid" | "retired";

export type Payout = {
  readonly id: string;
  readonly campaignId: string;
  readonly reviewer: string;
  readonly contributionIds: readonly string[];
  readonly units: bigint;
  readonly attempt: number;
  readonly status: PayoutStatus;
  // null between step 1 and step 3. A dry run stores "dry-run:<id>", which is
  // not a transaction hash and can never be marked paid.
  readonly reference: string | null;
  readonly retiredBecause?: "reverted" | "not_sent";
};

export type SettlementState = {
  readonly version: number;
  readonly payouts: Readonly<Record<string, Payout>>;
};

// One campaign's whole payment record: the maker's balances and the payouts.
export type PaymentRecord = {
  readonly balance: CampaignBalance;
  readonly settlement: SettlementState;
};

export type PlannedPayout = {
  readonly id: string;
  readonly campaignId: string;
  readonly reviewer: string;
  readonly contributionIds: readonly string[];
  readonly units: bigint;
  readonly attempt: number;
};

export type SettlementRefusal =
  | "payout_exists"
  | "unresolved_payout"
  | "below_threshold"
  | "plan_mismatch"
  | "not_earned"
  | "already_in_payout"
  | "no_such_payout"
  | "not_pending"
  | "reference_conflict"
  | "invalid_reference"
  | "no_reference"
  | BalanceRefusal;

export type SettlementTransition =
  | { readonly ok: true; readonly changed: boolean; readonly record: PaymentRecord }
  | { readonly ok: false; readonly reason: SettlementRefusal; readonly record: PaymentRecord };

export class SettlementInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementInvariantError";
  }
}

const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

export function openPaymentRecord(balance: CampaignBalance): PaymentRecord {
  return Object.freeze({ balance, settlement: Object.freeze({ version: 0, payouts: Object.freeze({}) }) });
}

// The payouts must agree with the balances they describe. Throws when they do not.
export function assertPaymentRecord(record: PaymentRecord): void {
  assertBalanceInvariant(record.balance);
  const holder = new Map<string, string>();
  const openByReviewer = new Set<string>();
  for (const p of Object.values(record.settlement.payouts)) {
    if (typeof p.units !== "bigint" || p.units <= ZERO) throw new SettlementInvariantError(`payout ${p.id} has no valid units`);
    if (p.status === "retired") continue;
    if (p.status === "pending") {
      if (openByReviewer.has(p.reviewer)) throw new SettlementInvariantError(`reviewer has two unresolved payouts (${p.id})`);
      openByReviewer.add(p.reviewer);
    }
    let total = ZERO;
    for (const id of p.contributionIds) {
      if (holder.has(id)) throw new SettlementInvariantError(`contribution ${id} is in two payouts: ${holder.get(id)} and ${p.id}`);
      holder.set(id, p.id);
      const c = own(record.balance.contributions, id);
      if (!c) throw new SettlementInvariantError(`payout ${p.id} names an unknown contribution ${id}`);
      if (c.reviewer !== p.reviewer) throw new SettlementInvariantError(`payout ${p.id} pays the wrong reviewer for ${id}`);
      total += c.units;
      if (p.status === "pending" && c.status !== "earned") {
        throw new SettlementInvariantError(`pending payout ${p.id} holds ${id}, which is ${c.status}`);
      }
      if (p.status === "paid" && (c.status !== "paid" || c.paidReference !== (p.reference || "").toLowerCase())) {
        throw new SettlementInvariantError(`payout ${p.id} reads paid and contribution ${id} does not carry its reference`);
      }
    }
    if (total !== p.units) throw new SettlementInvariantError(`payout ${p.id} says ${p.units}, its contributions add to ${total}`);
  }
  // The other direction: no contribution reads paid without a paid payout.
  for (const c of Object.values(record.balance.contributions)) {
    if (c.status !== "paid") continue;
    const id = holder.get(c.id);
    const p = id === undefined ? undefined : own(record.settlement.payouts, id);
    if (!p || p.status !== "paid") throw new SettlementInvariantError(`contribution ${c.id} reads paid with no paid payout`);
  }
}

function next(record: PaymentRecord, payouts: Record<string, Payout>, balance: CampaignBalance = record.balance): SettlementTransition {
  const out: PaymentRecord = Object.freeze({
    balance,
    settlement: Object.freeze({ version: record.settlement.version + 1, payouts: Object.freeze(payouts) }),
  });
  assertPaymentRecord(out);
  return { ok: true, changed: true, record: out };
}
const same = (record: PaymentRecord): SettlementTransition => ({ ok: true, changed: false, record });
const no = (record: PaymentRecord, reason: SettlementRefusal): SettlementTransition => ({ ok: false, reason, record });

// Contribution id to the payout that currently holds it (pending or paid).
function heldContributions(record: PaymentRecord): Map<string, Payout> {
  const held = new Map<string, Payout>();
  for (const p of Object.values(record.settlement.payouts)) {
    if (p.status === "retired") continue;
    for (const id of p.contributionIds) held.set(id, p);
  }
  return held;
}

function unresolvedFor(record: PaymentRecord, reviewer: string): Payout | undefined {
  return Object.values(record.settlement.payouts).find((p) => p.reviewer === reviewer && p.status === "pending");
}

// PLAN. Pure. For each reviewer: every earned contribution that no live payout
// holds, as one payout, when the total reaches the threshold and the reviewer has
// no unresolved payout. Sorted, so the same record always gives the same plan
// and the same payout ids.
export function planPayouts(
  record: PaymentRecord,
  options: { thresholdUnits?: bigint } = {},
): PlannedPayout[] {
  assertPaymentRecord(record);
  const threshold = options.thresholdUnits ?? DEFAULT_PAYOUT_THRESHOLD_UNITS;
  if (typeof threshold !== "bigint" || threshold <= ZERO) throw new TypeError("thresholdUnits must be positive bigint base units");
  const held = heldContributions(record);
  const byReviewer = new Map<string, string[]>();
  for (const c of Object.values(record.balance.contributions)) {
    if (c.status !== "earned" || held.has(c.id)) continue;
    const list = byReviewer.get(c.reviewer);
    if (list) list.push(c.id);
    else byReviewer.set(c.reviewer, [c.id]);
  }
  const plans: PlannedPayout[] = [];
  for (const reviewer of [...byReviewer.keys()].sort()) {
    if (unresolvedFor(record, reviewer)) continue;
    const contributionIds = byReviewer.get(reviewer)!.sort();
    const units = sumUsdcUnits(contributionIds.map((id) => record.balance.contributions[id].units));
    if (units < threshold) continue;
    const attempt = 1 + Object.values(record.settlement.payouts).filter((p) => p.reviewer === reviewer).length;
    plans.push({
      id: JSON.stringify([record.balance.campaignId, reviewer, attempt]),
      campaignId: record.balance.campaignId,
      reviewer,
      contributionIds,
      units,
      attempt,
    });
  }
  return plans;
}

// STEP 1. Save the payout as pending, with no reference. The plan is checked
// against the record as it is NOW, never trusted.
export function openPayout(
  record: PaymentRecord,
  plan: PlannedPayout,
  options: { thresholdUnits?: bigint } = {},
): SettlementTransition {
  assertPaymentRecord(record);
  const threshold = options.thresholdUnits ?? DEFAULT_PAYOUT_THRESHOLD_UNITS;
  if (own(record.settlement.payouts, plan.id)) return no(record, "payout_exists");
  if (plan.campaignId !== record.balance.campaignId) return no(record, "plan_mismatch");
  if (unresolvedFor(record, plan.reviewer)) return no(record, "unresolved_payout");
  if (!Array.isArray(plan.contributionIds) || plan.contributionIds.length === 0) return no(record, "nothing_to_pay");
  if (new Set(plan.contributionIds).size !== plan.contributionIds.length) return no(record, "duplicate_contribution");
  const held = heldContributions(record);
  let total = ZERO;
  for (const id of plan.contributionIds) {
    const c = own(record.balance.contributions, id);
    if (!c) return no(record, "not_reserved");
    if (c.reviewer !== plan.reviewer) return no(record, "mixed_reviewers");
    if (held.has(id)) return no(record, "already_in_payout");
    if (c.status !== "earned") return no(record, "not_earned");
    total += c.units;
  }
  if (total !== plan.units) return no(record, "plan_mismatch");
  if (total < threshold) return no(record, "below_threshold");
  const payout: Payout = Object.freeze({
    id: plan.id,
    campaignId: plan.campaignId,
    reviewer: plan.reviewer,
    contributionIds: Object.freeze([...plan.contributionIds]),
    units: total,
    attempt: plan.attempt,
    status: "pending" as const,
    reference: null,
  });
  return next(record, { ...record.settlement.payouts, [payout.id]: payout });
}

// STEP 3. Save the reference. Compare-and-set: it is written once. The same
// reference again is a replay; a different one is refused, because overwriting a
// saved reference is how a transfer that went out gets forgotten.
export function attachReference(record: PaymentRecord, payoutId: string, reference: string): SettlementTransition {
  assertPaymentRecord(record);
  const p = own(record.settlement.payouts, payoutId);
  if (!p) return no(record, "no_such_payout");
  if (typeof reference !== "string" || reference.length === 0) return no(record, "invalid_reference");
  if (p.reference !== null) return p.reference === reference ? same(record) : no(record, "reference_conflict");
  if (p.status !== "pending") return no(record, "not_pending");
  return next(record, { ...record.settlement.payouts, [p.id]: Object.freeze({ ...p, reference }) });
}

export type ReceiptStatus = "success" | "reverted" | "unknown";
export type ReceiptAnswer =
  | { readonly status: "success"; readonly units: bigint }
  | { readonly status: "reverted" }
  | { readonly status: "unknown" };

export type ReceiptReading = {
  readonly status: ReceiptStatus;
  // Set only for success: the units the transfer moved.
  readonly units?: bigint;
  // How many endpoints were asked, and what each one said. An endpoint that
  // threw is listed with its error; it is never dropped.
  readonly asked: number;
  readonly answers: ReadonlyArray<{ readonly endpoint: string; readonly status: ReceiptStatus; readonly error?: string }>;
  readonly conflict?: true;
};

export type ReceiptEndpoint = {
  readonly name: string;
  readonly read: (reference: string) => Promise<ReceiptAnswer>;
};
export type ReceiptReader = (reference: string) => Promise<ReceiptReading>;

// STEP 5. Apply a receipt reading to a pending payout.
export function settlePayout(record: PaymentRecord, payoutId: string, reading: ReceiptReading): SettlementTransition {
  assertPaymentRecord(record);
  const p = own(record.settlement.payouts, payoutId);
  if (!p) return no(record, "no_such_payout");
  if (p.status !== "pending") return same(record);
  if (p.reference === null) return no(record, "no_reference");
  if (!reading || reading.status === "unknown") return same(record);
  if (reading.status === "reverted") {
    return next(record, {
      ...record.settlement.payouts,
      [p.id]: Object.freeze({ ...p, status: "retired" as const, retiredBecause: "reverted" as const }),
    });
  }
  if (reading.status !== "success") return same(record);
  // paid is decided by campaign-balance, which wants a real transaction hash and
  // the exact amount. A refusal there leaves the payout pending.
  const paid = pay(record.balance, {
    contributionIds: p.contributionIds,
    receipt: { status: "success", reference: p.reference, units: reading.units as bigint },
  });
  if (!paid.ok) return no(record, paid.reason);
  return next(record, { ...record.settlement.payouts, [p.id]: Object.freeze({ ...p, status: "paid" as const }) }, paid.state);
}

// The sender said, in so many words, that nothing went out. The payout is
// retired and its units read earned again. This is NOT for a sender that threw
// or timed out: that one may have sent.
export function retireUnsentPayout(record: PaymentRecord, payoutId: string): SettlementTransition {
  assertPaymentRecord(record);
  const p = own(record.settlement.payouts, payoutId);
  if (!p) return no(record, "no_such_payout");
  if (p.status === "retired") return same(record);
  if (p.status !== "pending") return no(record, "not_pending");
  if (p.reference !== null) return no(record, "reference_conflict");
  return next(record, {
    ...record.settlement.payouts,
    [p.id]: Object.freeze({ ...p, status: "retired" as const, retiredBecause: "not_sent" as const }),
  });
}

// What one reviewer reads: three totals in base units. Reserved units are not
// here; they are not earned yet.
export function reviewerTotals(record: PaymentRecord, reviewer: string): Record<ReviewerPaymentState, bigint> {
  assertPaymentRecord(record);
  const held = heldContributions(record);
  let earned = ZERO;
  let pending = ZERO;
  let paid = ZERO;
  for (const c of Object.values(record.balance.contributions)) {
    if (c.reviewer !== reviewer) continue;
    if (c.status === "paid") paid += c.units;
    else if (c.status === "earned") {
      if (held.get(c.id)?.status === "pending") pending += c.units;
      else earned += c.units;
    }
  }
  return { earned, pending, paid };
}

// RECEIPT READER. Asks EVERY endpoint, in order, and keeps every answer.
//   success    at least one endpoint shows a success receipt, none shows a
//              revert, and the endpoints that show success agree on the units.
//   reverted   at least two endpoints show a revert and none shows a success.
//              This answer lets a new transfer go out, so one voice is not enough.
//   unknown    everything else, and never on fewer than two endpoints asked.
export function makeReceiptReader(endpoints: readonly ReceiptEndpoint[]): ReceiptReader {
  if (!Array.isArray(endpoints) || endpoints.length < MIN_RECEIPT_ENDPOINTS) {
    throw new RangeError(`A receipt reader needs at least ${MIN_RECEIPT_ENDPOINTS} endpoints. One endpoint that has no record is not proof of no payment.`);
  }
  if (new Set(endpoints.map((e) => e.name)).size !== endpoints.length) {
    throw new RangeError("Receipt endpoints must be distinct. The same endpoint asked twice is one voice.");
  }
  return async (reference: string): Promise<ReceiptReading> => {
    const answers: Array<{ endpoint: string; status: ReceiptStatus; error?: string }> = [];
    const successUnits: bigint[] = [];
    let reverts = 0;
    for (const endpoint of endpoints) {
      try {
        const answer = await endpoint.read(reference);
        if (answer && answer.status === "success" && typeof answer.units === "bigint" && answer.units > ZERO) {
          successUnits.push(answer.units);
          answers.push({ endpoint: endpoint.name, status: "success" });
        } else if (answer && answer.status === "reverted") {
          reverts++;
          answers.push({ endpoint: endpoint.name, status: "reverted" });
        } else {
          answers.push({ endpoint: endpoint.name, status: "unknown" });
        }
      } catch (err) {
        answers.push({ endpoint: endpoint.name, status: "unknown", error: err instanceof Error ? err.message : String(err) });
      }
    }
    const asked = answers.length;
    if (successUnits.length > 0 && reverts > 0) return { status: "unknown", asked, answers, conflict: true };
    if (successUnits.length > 0) {
      if (successUnits.some((u) => u !== successUnits[0])) return { status: "unknown", asked, answers, conflict: true };
      return { status: "success", units: successUnits[0], asked, answers };
    }
    if (reverts >= MIN_RECEIPT_ENDPOINTS) return { status: "reverted", asked, answers };
    return { status: "unknown", asked, answers };
  };
}

export type PayoutInstruction = {
  readonly payoutId: string;
  readonly campaignId: string;
  readonly reviewer: string;
  readonly units: bigint;
  readonly contributionIds: readonly string[];
};

export type SendResult =
  | { readonly status: "sent"; readonly reference: string }
  // A definite statement that nothing left. Never use it for "I am not sure".
  | { readonly status: "not_sent"; readonly reason: string }
  | { readonly status: "dry_run"; readonly reference: string };

export type PayoutSender = { readonly send: (instruction: PayoutInstruction) => Promise<SendResult> };

// THE ONLY SENDER IN THIS FILE. It sends nothing. It records each instruction it
// was given and answers with a reference that is not a transaction hash, so the
// payout it belongs to can never be marked paid.
export function makeDryRunSender(): PayoutSender & { readonly wouldSend: readonly PayoutInstruction[] } {
  const wouldSend: PayoutInstruction[] = [];
  return {
    wouldSend,
    send: async (instruction) => {
      wouldSend.push(Object.freeze({ ...instruction, contributionIds: Object.freeze([...instruction.contributionIds]) }));
      return { status: "dry_run", reference: `dry-run:${instruction.payoutId}` };
    },
  };
}

export type SettlementDeps = {
  readonly sender: PayoutSender;
  readonly readReceipt: ReceiptReader;
  // Persist `next`, which was derived from `previous`. A real store rejects the
  // write when its copy is no longer `previous`. A throw stops the run.
  readonly save: (next: PaymentRecord, previous: PaymentRecord) => Promise<void>;
  readonly thresholdUnits?: bigint;
};

export type PayoutOutcome =
  // The payout was already on the record. Nothing was sent.
  | { readonly outcome: "replay"; readonly status: PayoutStatus; readonly record: PaymentRecord }
  | { readonly outcome: "refused"; readonly reason: SettlementRefusal; readonly record: PaymentRecord }
  | { readonly outcome: "paid"; readonly record: PaymentRecord; readonly reading: ReceiptReading }
  // Sent, reference saved, receipt not a success yet. `payRefused` is set when a
  // success receipt was read and campaign-balance would not accept it.
  | { readonly outcome: "pending"; readonly record: PaymentRecord; readonly reading: ReceiptReading; readonly payRefused?: SettlementRefusal }
  | { readonly outcome: "retired"; readonly because: "reverted" | "not_sent"; readonly record: PaymentRecord }
  // The sender threw or timed out. The payout stays pending with no reference
  // and is not sent again. A person must check whether a transfer went out.
  | { readonly outcome: "send_unconfirmed"; readonly record: PaymentRecord; readonly error: string }
  | { readonly outcome: "dry_run"; readonly record: PaymentRecord; readonly reference: string };

// A transfer went out and its reference could not be saved. The reference is in
// the error so it is not lost with the failed write.
export class ReferenceNotSavedError extends Error {
  constructor(
    readonly payoutId: string,
    readonly reference: string,
    readonly cause: unknown,
  ) {
    super(`Payout ${payoutId} was sent with reference ${reference} and the reference could not be saved. Do not send it again. Record this reference by hand.`);
    this.name = "ReferenceNotSavedError";
  }
}

// RUN ONE PAYOUT, in the order at the top of this file.
export async function runPayout(deps: SettlementDeps, record: PaymentRecord, plan: PlannedPayout): Promise<PayoutOutcome> {
  assertPaymentRecord(record);
  const existing = own(record.settlement.payouts, plan.id);
  if (existing) return { outcome: "replay", status: existing.status, record };

  // 1. Reserve the payout before anything is sent.
  const opened = openPayout(record, plan, { thresholdUnits: deps.thresholdUnits });
  if (!opened.ok) return { outcome: "refused", reason: opened.reason, record };
  await deps.save(opened.record, record);
  const payout = opened.record.settlement.payouts[plan.id];

  // 2. Send, once.
  let sent: SendResult;
  try {
    sent = await deps.sender.send({
      payoutId: payout.id,
      campaignId: payout.campaignId,
      reviewer: payout.reviewer,
      units: payout.units,
      contributionIds: payout.contributionIds,
    });
  } catch (err) {
    return { outcome: "send_unconfirmed", record: opened.record, error: err instanceof Error ? err.message : String(err) };
  }
  if (sent.status === "not_sent") {
    const retired = retireUnsentPayout(opened.record, payout.id);
    if (!retired.ok) return { outcome: "refused", reason: retired.reason, record: opened.record };
    await deps.save(retired.record, opened.record);
    return { outcome: "retired", because: "not_sent", record: retired.record };
  }

  // 3. Save the reference before any receipt is awaited.
  const referenced = attachReference(opened.record, payout.id, sent.reference);
  if (!referenced.ok) throw new ReferenceNotSavedError(payout.id, String(sent.reference), referenced.reason);
  try {
    await deps.save(referenced.record, opened.record);
  } catch (err) {
    throw new ReferenceNotSavedError(payout.id, sent.reference, err);
  }
  if (sent.status === "dry_run") return { outcome: "dry_run", record: referenced.record, reference: sent.reference };
  if (!TX_HASH.test(sent.reference)) {
    // Saved, and no receipt can be read for it. It stays pending for a person.
    return {
      outcome: "send_unconfirmed",
      record: referenced.record,
      error: "The sender answered with a reference that is not a transaction hash.",
    };
  }

  // 4 and 5. Read the receipt and apply it.
  return resolveOne(deps, referenced.record, payout.id);
}

async function resolveOne(deps: SettlementDeps, record: PaymentRecord, payoutId: string): Promise<PayoutOutcome> {
  const payout = record.settlement.payouts[payoutId];
  const reading = await deps.readReceipt(payout.reference as string);
  const settled = settlePayout(record, payoutId, reading);
  if (!settled.ok) return { outcome: "pending", record, reading, payRefused: settled.reason };
  if (!settled.changed) return { outcome: "pending", record, reading };
  await deps.save(settled.record, record);
  const after = settled.record.settlement.payouts[payoutId];
  if (after.status === "paid") return { outcome: "paid", record: settled.record, reading };
  return { outcome: "retired", because: "reverted", record: settled.record };
}

// LATER RUNS. Every pending payout that has a transaction reference is read
// again. Nothing is sent here, ever. A pending payout with no reference, or with
// a dry-run reference, is handed back for a person to look at.
export async function resolvePendingPayouts(
  deps: Pick<SettlementDeps, "readReceipt" | "save">,
  record: PaymentRecord,
): Promise<{ record: PaymentRecord; outcomes: Array<{ payoutId: string; result: PayoutOutcome }>; needsOperator: string[] }> {
  assertPaymentRecord(record);
  let current = record;
  const outcomes: Array<{ payoutId: string; result: PayoutOutcome }> = [];
  const needsOperator: string[] = [];
  for (const id of Object.keys(record.settlement.payouts).sort()) {
    const p = current.settlement.payouts[id];
    if (p.status !== "pending") continue;
    if (p.reference === null || !TX_HASH.test(p.reference)) {
      needsOperator.push(id);
      continue;
    }
    const result = await resolveOne({ ...deps, sender: NEVER_SENDS }, current, id);
    current = result.record;
    outcomes.push({ payoutId: id, result });
  }
  return { record: current, outcomes, needsOperator };
}

const NEVER_SENDS: PayoutSender = {
  send: async () => {
    throw new Error("resolvePendingPayouts never sends");
  },
};
