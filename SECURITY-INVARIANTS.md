# FAVOUR security invariants

Real money and points move through this app. These are the invariants that MUST
hold. ~20 broad code reviews missed violations of them because broad reads skim
the happy path; money/security bugs live at the edges. So: this list is checked
on every money/identity/reward change, findings are verified against real code +
a live request (not a summary), and the guard test (`src/__tests__/invariants.guard.test.ts`)
mechanically blocks the easy-to-regress ones.

## Invariants

1. **Points ≠ USDC.** `bountyUsdc` is dollars ONLY when the task is escrow-funded
   (`onChainId !== null || escrowTxHash`). On a points task it is a points value.
   Never sum `bountyUsdc` into a money figure without the funded guard. Go through
   `reward.ts` (`isRealMoney` / `rewardAmountLabel` / `sumRewards`).
2. **Paid means settled, and money is AI-verified only.** A task is "paid" only
   when it has a confirmed on-chain `settlementTx` (`!pendingRelease`).
   `status === "completed"` is NOT paid. Every escrow release awaits the receipt,
   checks `receipt.status === "success"`, and records `markSettled` /
   `markSettlementPending` — never fire-and-forget. **Funded USDC releases ONLY
   through AI verification** (verify-proof consensus, or dispute AI mediation).
   Manual poster-confirm must NEVER release funded escrow — it was the spoofable
   theft vector. A flagged funded proof is resubmitted, disputed, or expires+refunds.
3. **Funding is verified on-chain.** A task stores as funded only after
   `isEscrowTaskFunded` confirms the escrow. Applies to POST *and* PATCH *and*
   seed (real `0x`+64hex tx hash, never a placeholder string).
4. **Identity is proven, not claimed.** A mutating action attributed to a wallet
   must be authorized by that wallet's session (`src/lib/session.ts`), not by a
   `body.poster/claimant/submitter/sender` field (all public). Gate: `SESSION_ENFORCE`.
5. **AI proof never earns.** A `flag`/AI-suspected verdict must not award points,
   USDC, completions, reputation, leaderboard, or campaign progress. No random
   verdict (`verifyProofStub`) in production.
6. **One escrow funds one payout.** Funded tasks are single-completion.
7. **Verification tier gates funded tasks only** (not points), on every claim path
   (`/claim` and the `verify-proof` direct-submit path).
8. **Campaign cash unlocks only through the clean gate.** (`src/lib/campaign-unlock.ts`)
   Progress counts ONLY pass-verdict + Orb-verified completions, written ONLY by the
   verify-proof pass path. The pot is a hard cap enforced by slot reservation BEFORE
   the transfer; the payout tx hash is persisted BEFORE awaiting its receipt; `paid`
   flips only on a confirmed success receipt; unresolved broadcasts back off (never
   re-send); failures land in `unlock:retry`, drained by the reconcile cron.

## Review method for any money/identity/reward change

- Name the failure CLASS, don't just read the diff. One bug ⇒ assume siblings.
- Hunt each class to `file:line` adversarially ("how do I break this?").
- Verify every finding against the real code AND a live request before believing it.
- Prefer an automated guard (extend the guard test) over a promise. A guard that
  only greps source for a call site is a doc aid, NOT a gate — make it behavioral
  (exercise the collision / the failure it's supposed to stop).
- **A write-time invariant is retroactively false for existing data.** Any change
  that starts enforcing a uniqueness/binding/required-field rule (e.g. Inv 6's
  `escrow:bind:*`) MUST ship with (a) a backfill that makes existing rows conform
  and (b) a count of how many rows currently violate it. "New code path enforces
  it" ≠ "the invariant holds." The Jul 12 escrow-drain fix passed tsc + 116 tests
  while ~$7 of pre-fix escrows stayed drainable because the bind was never
  backfilled — caught only by the live-request rule below.
- `tsc` + `next build` + guard test green before merge.
