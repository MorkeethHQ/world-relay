// CAMPAIGN BALANCE (2026-10-08): the payment record of one review budget.
//
// STATUS: a pure core. Nothing in src/app imports it, no route calls it, no store
// holds it and it moves no money. It has no network, no key, no env read and no
// clock of its own (`now` is always a parameter). Funding and the switch are
// Oscar's. Until both happen this file changes nothing a person can see.
//
// WHAT IT MODELS. A maker deposits a review budget. A slice of the budget is
// reserved for one contribution before the reviewer is promised anything. When
// the contribution is accepted it is earned. When a transfer to the reviewer has
// a success receipt it is paid. After the deadline, what nobody earned can go
// back to the maker.
//
// FOUR BALANCES, all bigint USDC base units (1 USDC is 1,000,000 units). The
// names come from the money study of 2026-10-08, section 6:
//   available    deposited and not promised to anyone.
//   committed    reserved for a contribution, or earned and not yet paid.
//   paid         sent to a reviewer, with a success receipt for the transfer.
//   refundable   left for the maker after the deadline.
// THE RULE: available + committed + paid + refundable = deposited.
// It is checked on the way into and on the way out of every transition below,
// against the buckets and against the records behind them.
//
// TRANSITIONS. Each one returns a new frozen state, or the same state with a
// reason. A refused transition changes nothing, so a reservation is all or
// nothing.
//   deposit   a real 0x plus 64 hex transaction hash that the injected verifier
//             confirms. The amount is the verifier's, read from the chain, never
//             the caller's. Before the deadline it lands in available, after it
//             lands in refundable. The same hash twice is one deposit.
//   reserve   available to committed, keyed by contribution id. Refused after
//             the deadline and refused when available is short.
//   accrue    a reserved contribution becomes earned. Compare-and-set on the
//             contribution id: the same accrual again changes nothing, and a
//             different amount under the same id is refused. No balance moves,
//             because the units were already committed.
//   release   a reserved contribution that was not accepted goes back to
//             available (or to refundable after the deadline). An earned
//             contribution cannot be released.
//   pay       committed to paid, only with a success receipt whose amount is the
//             exact sum of the batch. The same receipt again changes nothing. A
//             second receipt for a paid contribution is refused.
//   refund    after the deadline, available to refundable.
//
// SENTIMENT IS NOT AN INPUT. No function here takes a rating, a verdict tone or
// the text of a review. A valid negative review accrues the same units as a
// valid positive one, because the amount was fixed at reserve time.
//
// OPEN, ALL OSCAR'S (nothing here picks them): the deposit rail, the deadline and
// the refund rule, whether the deadline releases a reservation that is still
// under review (this core never does that by itself: see `release`), the fee,
// the payout wallet. Sending a refund is not modelled. `refundable` is what the
// maker may take back, and no function here says it was returned.
//
// WHAT A STORE MUST ADD before this is wired (SECURITY-INVARIANTS, 2026-10-05
// amendment): every state has a `version`. A store writes a new state only as a
// compare-and-set on that version, in one atomic script, so a write whose answer
// never arrives is read back as its own. A deposit hash must be claimed once
// across ALL campaigns (the Inv 6 pattern), which one campaign's state cannot
// see. bigint is not JSON: the store encodes units as decimal strings.

import { sumUsdcUnits } from "./reward";

const ZERO = BigInt(0);
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export type ContributionStatus = "reserved" | "earned" | "paid" | "released";

export type Contribution = {
  readonly id: string;
  // Opaque reviewer key. Which wallet it pays to is not decided here.
  readonly reviewer: string;
  readonly units: bigint;
  readonly status: ContributionStatus;
  // Set only when status is "paid": the transfer whose receipt was a success.
  readonly paidReference?: string;
};

export type CampaignBalance = {
  readonly campaignId: string;
  // Milliseconds since the epoch. Unruled: the caller supplies it.
  readonly deadline: number;
  // Goes up by one on every transition that changed something. For the store's
  // compare-and-set.
  readonly version: number;
  readonly deposited: bigint;
  readonly available: bigint;
  readonly committed: bigint;
  readonly paid: bigint;
  readonly refundable: bigint;
  // Verified deposits: lower-case transaction hash to units.
  readonly deposits: Readonly<Record<string, bigint>>;
  readonly contributions: Readonly<Record<string, Contribution>>;
};

export type BalanceRefusal =
  | "invalid_time"
  | "invalid_id"
  | "invalid_amount"
  | "not_a_transaction_hash"
  | "verifier_failed"
  | "deposit_not_confirmed"
  | "deposit_unknown"
  | "past_deadline"
  | "before_deadline"
  | "insufficient_available"
  | "id_conflict"
  | "not_reserved"
  | "amount_mismatch"
  | "released"
  | "already_earned"
  | "not_earned"
  | "nothing_to_pay"
  | "duplicate_contribution"
  | "mixed_reviewers"
  | "receipt_not_success"
  | "receipt_amount_mismatch"
  | "reference_is_a_deposit"
  | "reference_already_used"
  | "already_paid"
  | "batch_mismatch";

// `changed: false` on an ok result means a replay: the transition had already
// been applied and the state is the one passed in.
export type BalanceTransition =
  | { readonly ok: true; readonly changed: boolean; readonly state: CampaignBalance }
  | { readonly ok: false; readonly reason: BalanceRefusal; readonly state: CampaignBalance };

export type DepositVerdict =
  | { readonly status: "confirmed"; readonly units: bigint }
  | { readonly status: "not_confirmed" }
  | { readonly status: "unknown" };

// Injected. It asks the chain whether this transaction is a confirmed deposit
// FOR THIS CAMPAIGN and how many units it carried. This module ships no verifier.
export type DepositVerifier = (query: { campaignId: string; txHash: string }) => Promise<DepositVerdict>;

// What `pay` accepts as proof. Only a success receipt for a real transaction
// hash, carrying the units the transfer moved.
export type SuccessReceipt = { readonly status: "success"; readonly reference: string; readonly units: bigint };

export class BalanceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceInvariantError";
  }
}

const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

const isUnits = (v: unknown): v is bigint => typeof v === "bigint";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// THE RULE, as a function. Throws when the state does not add up. It checks the
// four buckets against `deposited`, and each figure against the records it is
// supposed to summarise, so a bucket cannot drift from its rows by one unit.
export function assertBalanceInvariant(state: CampaignBalance): void {
  const figures: Array<[string, unknown]> = [
    ["deposited", state.deposited],
    ["available", state.available],
    ["committed", state.committed],
    ["paid", state.paid],
    ["refundable", state.refundable],
  ];
  for (const [name, value] of figures) {
    if (!isUnits(value)) throw new BalanceInvariantError(`${name} is not bigint base units`);
    if (value < ZERO) throw new BalanceInvariantError(`${name} is negative: ${value}`);
  }
  const total = state.available + state.committed + state.paid + state.refundable;
  if (total !== state.deposited) {
    throw new BalanceInvariantError(
      `available ${state.available} + committed ${state.committed} + paid ${state.paid} + refundable ${state.refundable} = ${total}, deposited is ${state.deposited}`,
    );
  }
  const fromDeposits = sumUsdcUnits(Object.values(state.deposits));
  if (fromDeposits !== state.deposited) {
    throw new BalanceInvariantError(`deposit records add to ${fromDeposits}, deposited is ${state.deposited}`);
  }
  let committed = ZERO;
  let paid = ZERO;
  for (const c of Object.values(state.contributions)) {
    if (!isUnits(c.units) || c.units <= ZERO) throw new BalanceInvariantError(`contribution ${c.id} has no valid units`);
    if (c.status === "reserved" || c.status === "earned") committed += c.units;
    else if (c.status === "paid") paid += c.units;
  }
  if (committed !== state.committed) {
    throw new BalanceInvariantError(`open contributions add to ${committed}, committed is ${state.committed}`);
  }
  if (paid !== state.paid) {
    throw new BalanceInvariantError(`paid contributions add to ${paid}, paid is ${state.paid}`);
  }
}

type Patch = Partial<Pick<CampaignBalance, "deposited" | "available" | "committed" | "paid" | "refundable" | "deposits" | "contributions">>;

// The only way a new state leaves this module.
function commit(prev: CampaignBalance, patch: Patch): BalanceTransition {
  const next: CampaignBalance = {
    ...prev,
    ...patch,
    version: prev.version + 1,
  };
  assertBalanceInvariant(next);
  Object.freeze(next.deposits);
  Object.freeze(next.contributions);
  return { ok: true, changed: true, state: Object.freeze(next) };
}

const replay = (state: CampaignBalance): BalanceTransition => ({ ok: true, changed: false, state });
const refuse = (state: CampaignBalance, reason: BalanceRefusal): BalanceTransition => ({ ok: false, reason, state });

export function openCampaignBalance(input: { campaignId: string; deadline: number }): CampaignBalance {
  if (!isId(input.campaignId)) throw new TypeError("openCampaignBalance needs a campaign id");
  if (!isTime(input.deadline)) throw new TypeError("openCampaignBalance needs a deadline in milliseconds");
  const state: CampaignBalance = {
    campaignId: input.campaignId,
    deadline: input.deadline,
    version: 0,
    deposited: ZERO,
    available: ZERO,
    committed: ZERO,
    paid: ZERO,
    refundable: ZERO,
    deposits: Object.freeze({}),
    contributions: Object.freeze({}),
  };
  return Object.freeze(state);
}

// DEPOSIT. The only async transition, because the verifier asks the chain.
// The order matters: a string that is not a transaction hash is refused before
// the verifier is asked, so a verifier that answers yes to everything still
// cannot fund a campaign with the placeholder "funded" (Inv 3).
export async function deposit(
  state: CampaignBalance,
  input: { txHash: string },
  verifier: DepositVerifier,
  now: number,
): Promise<BalanceTransition> {
  assertBalanceInvariant(state);
  if (!isTime(now)) return refuse(state, "invalid_time");
  if (typeof input.txHash !== "string" || !TX_HASH.test(input.txHash)) return refuse(state, "not_a_transaction_hash");
  const key = input.txHash.toLowerCase();
  if (own(state.deposits, key) !== undefined) return replay(state);

  let verdict: DepositVerdict;
  try {
    verdict = await verifier({ campaignId: state.campaignId, txHash: input.txHash });
  } catch {
    // Fail closed, and say so: no answer is not a yes.
    return refuse(state, "verifier_failed");
  }
  if (!verdict || verdict.status === "unknown") return refuse(state, "deposit_unknown");
  if (verdict.status !== "confirmed") return refuse(state, "deposit_not_confirmed");
  if (!isUnits(verdict.units) || verdict.units <= ZERO) return refuse(state, "invalid_amount");

  const late = now >= state.deadline;
  return commit(state, {
    deposited: state.deposited + verdict.units,
    available: late ? state.available : state.available + verdict.units,
    refundable: late ? state.refundable + verdict.units : state.refundable,
    deposits: { ...state.deposits, [key]: verdict.units },
  });
}

// RESERVE. The slot is taken here, before any promise and before any transfer.
export function reserve(
  state: CampaignBalance,
  input: { contributionId: string; reviewer: string; units: bigint },
  now: number,
): BalanceTransition {
  assertBalanceInvariant(state);
  if (!isTime(now)) return refuse(state, "invalid_time");
  if (!isId(input.contributionId) || !isId(input.reviewer)) return refuse(state, "invalid_id");
  if (!isUnits(input.units) || input.units <= ZERO) return refuse(state, "invalid_amount");

  const existing = own(state.contributions, input.contributionId);
  if (existing) {
    // Anything else under the same id is a different claim on the same slot.
    if (existing.reviewer !== input.reviewer || existing.units !== input.units) return refuse(state, "id_conflict");
    // A released slot holds no units. Answering "ok" would let a caller promise
    // money that is no longer set aside. A new attempt needs a new id.
    if (existing.status === "released") return refuse(state, "released");
    // The same reservation again is a replay.
    return replay(state);
  }
  if (now >= state.deadline) return refuse(state, "past_deadline");
  if (state.available < input.units) return refuse(state, "insufficient_available");

  const contribution: Contribution = Object.freeze({
    id: input.contributionId,
    reviewer: input.reviewer,
    units: input.units,
    status: "reserved" as const,
  });
  return commit(state, {
    available: state.available - input.units,
    committed: state.committed + input.units,
    contributions: { ...state.contributions, [input.contributionId]: contribution },
  });
}

// ACCRUE. Compare-and-set keyed by the contribution id: expected "reserved",
// new "earned". The amount must be the reserved amount. There is no parameter
// for what the review said.
export function accrue(state: CampaignBalance, input: { contributionId: string; units: bigint }): BalanceTransition {
  assertBalanceInvariant(state);
  if (!isId(input.contributionId)) return refuse(state, "invalid_id");
  if (!isUnits(input.units) || input.units <= ZERO) return refuse(state, "invalid_amount");
  const c = own(state.contributions, input.contributionId);
  if (!c) return refuse(state, "not_reserved");
  if (c.units !== input.units) return refuse(state, "amount_mismatch");
  if (c.status === "released") return refuse(state, "released");
  if (c.status === "earned" || c.status === "paid") return replay(state);
  return commit(state, {
    contributions: { ...state.contributions, [c.id]: Object.freeze({ ...c, status: "earned" as const }) },
  });
}

// RELEASE. A reservation that was not accepted gives its units back.
export function release(state: CampaignBalance, input: { contributionId: string }, now: number): BalanceTransition {
  assertBalanceInvariant(state);
  if (!isTime(now)) return refuse(state, "invalid_time");
  if (!isId(input.contributionId)) return refuse(state, "invalid_id");
  const c = own(state.contributions, input.contributionId);
  if (!c) return refuse(state, "not_reserved");
  if (c.status === "released") return replay(state);
  if (c.status !== "reserved") return refuse(state, "already_earned");
  const late = now >= state.deadline;
  return commit(state, {
    committed: state.committed - c.units,
    available: late ? state.available : state.available + c.units,
    refundable: late ? state.refundable + c.units : state.refundable,
    contributions: { ...state.contributions, [c.id]: Object.freeze({ ...c, status: "released" as const }) },
  });
}

// PAY. Committed becomes paid only here, and only with a success receipt.
// One transfer pays one reviewer one batch, and the batch is paid whole or not
// at all.
export function pay(
  state: CampaignBalance,
  input: { contributionIds: readonly string[]; receipt: SuccessReceipt },
): BalanceTransition {
  assertBalanceInvariant(state);
  const { contributionIds: ids, receipt } = input;
  if (!receipt || receipt.status !== "success") return refuse(state, "receipt_not_success");
  if (typeof receipt.reference !== "string" || !TX_HASH.test(receipt.reference)) return refuse(state, "not_a_transaction_hash");
  if (!isUnits(receipt.units) || receipt.units <= ZERO) return refuse(state, "invalid_amount");
  if (!Array.isArray(ids) || ids.length === 0) return refuse(state, "nothing_to_pay");
  if (new Set(ids).size !== ids.length) return refuse(state, "duplicate_contribution");

  const reference = receipt.reference.toLowerCase();
  // A deposit into the campaign is a success receipt too. It pays nobody.
  if (own(state.deposits, reference) !== undefined) return refuse(state, "reference_is_a_deposit");

  const batch: Contribution[] = [];
  for (const id of ids) {
    if (!isId(id)) return refuse(state, "invalid_id");
    const c = own(state.contributions, id);
    if (!c) return refuse(state, "not_reserved");
    batch.push(c);
  }
  if (new Set(batch.map((c) => c.reviewer)).size !== 1) return refuse(state, "mixed_reviewers");
  if (sumUsdcUnits(batch.map((c) => c.units)) !== receipt.units) return refuse(state, "receipt_amount_mismatch");

  const alreadyPaid = batch.filter((c) => c.status === "paid");
  if (alreadyPaid.some((c) => c.paidReference !== reference)) return refuse(state, "already_paid");
  // The same transfer cannot also pay a contribution outside this batch.
  const inBatch = new Set(ids);
  for (const c of Object.values(state.contributions)) {
    if (c.paidReference === reference && !inBatch.has(c.id)) return refuse(state, "reference_already_used");
  }
  if (alreadyPaid.length === batch.length) return replay(state);
  if (alreadyPaid.length > 0) return refuse(state, "batch_mismatch");
  for (const c of batch) {
    if (c.status === "released") return refuse(state, "released");
    if (c.status !== "earned") return refuse(state, "not_earned");
  }

  const contributions: Record<string, Contribution> = { ...state.contributions };
  for (const c of batch) {
    contributions[c.id] = Object.freeze({ ...c, status: "paid" as const, paidReference: reference });
  }
  return commit(state, {
    committed: state.committed - receipt.units,
    paid: state.paid + receipt.units,
    contributions,
  });
}

// REFUND ACCOUNTING. After the deadline, what is still available is the maker's
// to take back. Reserved and earned units stay committed: a reviewer who did the
// work is not unpaid by a date passing.
export function refund(state: CampaignBalance, now: number): BalanceTransition {
  assertBalanceInvariant(state);
  if (!isTime(now)) return refuse(state, "invalid_time");
  if (now < state.deadline) return refuse(state, "before_deadline");
  if (state.available === ZERO) return replay(state);
  return commit(state, {
    available: ZERO,
    refundable: state.refundable + state.available,
  });
}

// The five figures a maker reads, in base units. Format them with
// usdcUnitsToText from reward.ts and nothing else.
export function campaignBalances(state: CampaignBalance): {
  deposited: bigint;
  available: bigint;
  committed: bigint;
  paid: bigint;
  refundable: bigint;
} {
  assertBalanceInvariant(state);
  return {
    deposited: state.deposited,
    available: state.available,
    committed: state.committed,
    paid: state.paid,
    refundable: state.refundable,
  };
}
