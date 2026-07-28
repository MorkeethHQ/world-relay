/**
 * CUSTODY IS RETIRED.
 *
 * FAVOUR no longer takes custody of anyone's money. No user is ever asked to
 * sign a transaction against a first-party contract, and no new funds can enter
 * the escrow. This is a server-enforced rule, not a convention — see the guard
 * test in `src/__tests__/custody-retired.guard.test.ts`.
 *
 * WHY (decided 2026-07-28, on measured data, not instinct):
 *
 * 1. Nobody used it. `usdc_post_attempt` fires at the top of the USDC branch of
 *    the post wizard, before the balance check and before any wall. Since the
 *    instrumentation shipped 2026-07-19 it has recorded ZERO. Not "blocked at
 *    the funding wall" — nobody ever chose USDC. Over the same period the free
 *    surfaces did 1,608 jury verdicts, 128 poll votes and 44 prediction stakes
 *    against 12,689 page views. Historically, 0 of 22 escrow-funded tasks ever
 *    came from a real user; every one came from the `agent:relay` seeder.
 *
 * 2. The World dev portal rejected the listing with "verify all contracts". The
 *    deployed implementation behind the escrow proxy is unverified and its
 *    source no longer exists (`git log --all -S"fundTask" -- '*.sol'` = 0
 *    commits; the tracked RelayAgentEscrowV2.sol is an earlier version with no
 *    `fundTask`). Verifying therefore means reconstructing or rewriting the
 *    contract, and even then the proxy's `owner()` is the relayer HOT WALLET,
 *    which World's immutability requirement would still fail.
 *
 * 3. Retiring removes the rejection reason and the removal risk together, and
 *    it costs nothing real: `openLocked` was 0 at the time of the decision, so
 *    no user funds were stranded.
 *
 * WHAT THIS DOES NOT KILL — read this before "restoring" anything:
 *
 *   Real money still moves. The campaign unlock pays real USDC via a plain
 *   ERC-20 `transfer` from the relayer wallet (`defaultSendPayout` in
 *   campaign-unlock.ts) on World Chain's canonical USDC. That is NOT custody
 *   and NOT a first-party contract — nobody's funds sit in anything we wrote,
 *   and there is nothing of ours for World to verify. Points, predictions,
 *   polls and jury are untouched: predictions stake POINTS, not USDC.
 *
 * Closed at independent layers, each with a guard test (see
 * `src/__tests__/custody-retired.guard.test.ts`):
 *   1. encoders in contracts.ts return null (custodyClosed)
 *   2. UI post picker + fund button gated
 *   3. POST /api/tasks rejects money favours; /api/agent/fund → 410
 *   4. POST /api/agent/tasks funding/bind → 410; PATCH escrow bind → 410;
 *      seed funded batch → 410; createEscrowTaskWithKey / createAgentTask /
 *      encodeAgentDeposit|Withdraw gated; encodeUniswapSwap always null
 *
 * Leave paths (releaseEscrow / refundEscrow / reconcile / expire) stay so
 * historical Open/Claimed rows can still settle. NEW enter is closed.
 *
 * The remaining escrow code is deliberately left in place, read-only, so the
 * historical record (37 on-chain tasks, $27.50 paid out) stays legible and the
 * reconcile/expire crons keep working. What is closed is the way IN.
 *
 * TO REVERSE THIS you do not flip this constant. You deploy a new contract
 * with its source in this repo and its owner on a cold or multisig wallet,
 * verified on the explorer before a single user signs anything. The old
 * implementation must never take another deposit.
 */
export const CUSTODY_RETIRED = true;

/** Escrow entry points return null when custody is retired, so no user-facing
 *  transaction against a first-party contract can be constructed at all. */
export function custodyClosed(): boolean {
  return CUSTODY_RETIRED;
}
