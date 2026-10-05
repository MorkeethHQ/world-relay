# FAVOUR security invariants

Real money and points move through this app. These are the invariants that MUST
hold. ~20 broad code reviews missed violations of them because broad reads skim
the happy path; money/security bugs live at the edges. So: this list is checked
on every money/identity/reward change, findings are verified against real code +
a live request (not a summary), and the guard test (`src/__tests__/invariants.guard.test.ts`)
mechanically blocks the easy-to-regress ones.

## Invariants

1. **Points ≠ USDC.** `bountyUsdc` is dollars ONLY when the task is escrow-funded.
   On a points task it is a points value. Never sum `bountyUsdc` into a money figure
   without the funded guard. Go through `reward.ts` — it is the single source.

   **Which funded guard depends on the JOB, and this line used to name only the loose
   one (Jul 17 fix).** There are two, and their safe defaults point in OPPOSITE
   directions:
   - `isFunded` / `isRealMoney` — LOOSE (`onChainId !== null || !!escrowTxHash`).
     For **gates and labels**: tier gate, `moneyAtStake`, consensus spend, badges.
     Fail-SAFE — leaning loose only ever adds protection.
   - `hasOnChainEscrow` — STRICT (`onChainId != null && /^0x[0-9a-fA-F]{64}$/`).
     For **crediting**: reputation, earnings totals, payouts. Fail-CLOSED — leaning
     loose invents money. A truthy placeholder (`escrowTxHash: "funded"`, which
     legacy seeds really shipped) satisfies the loose check with no chain backing.

   Never reuse one signal for both. `verify-proof` did, and "just tighten it" would
   have fixed the credit while silently NARROWING the tier gate. Guards:
   `earned-usdc-credit.test.ts` (rule) + `verify-proof-credit-wiring.test.ts` (wiring).
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
   `body.poster/claimant/submitter/sender` field (all public).

   **The invariant is the property above. It is not the switch.** This line used
   to end "Gate: `SESSION_ENFORCE`", which made the rule circular: it said
   identity MUST be proven, and then pointed at a flag that decides whether it is.
   An invariant that names its own off-switch cannot be violated, only disabled,
   which is how it went months without anyone calling it broken.
   `SESSION_ENFORCE` is an implementation detail of the rollout. **It cannot
   weaken the invariant, it can only record that the code does not yet satisfy
   it.**

   **CONFORMANCE, measured 2026-09-16: NOT MET in production.** An unauthenticated
   POST to `/api/jury` claiming an arbitrary wallet was answered **409, not 403**,
   so it passed the ownership check and reached the store. The control that proves
   this is not a probe artifact: the same unauthenticated shape sent to
   `/api/daily`, which enforces independently of the switch, returned **403** in
   the same minute on the same deploy. Consequence: anyone can cast jury verdicts
   as any wallet, bounded only by an IP rate limit, and jury is the app's dominant
   human action at 2,738 lifetime verdicts.

   **Why it is still not met, and it is not an oversight.** Turning the switch on
   today locks out most live users. The session cookie is issued only in
   `/api/verify-identity` on a verified SIWE signature and lasts 7 days;
   `src/app/page.tsx` treats a stored `relay_user_id` as signed in and never calls
   that route again, so a returning user never refreshes it; `dev_` accounts never
   receive one at all. Upper bound from `/api/stats/retention` the same day: 55
   `sign_in` events in 7 days against 494 registered users, so **at most ~11% of
   users could hold a valid cookie**.

   **The gate itself works and has been proven end to end**, against a running
   instance rather than a mock: with `SESSION_ENFORCE` unset the unauthenticated
   jury call returns 409, and with `SESSION_ENFORCE=true` the identical call
   returns **403 "Please re-open the app to re-authenticate before this action."**
   The blocker is the client re-auth path, not the server check.

   **Order to conformance:** read the `session_authed` / `session_anon` shadow
   counters (instrumented in `ownershipError`) for a day to replace the 11% bound
   with a measured rate; give returning users a way to re-establish a cookie;
   confirm `SESSION_SECRET` or `ADMIN_SECRET` is actually set in the Vercel
   environment, because if neither is, `secret()` returns null, no cookie can ever
   be issued and enforcing closes every gated route to everybody; then flip and
   watch the counters. **Until then this invariant is recorded as violated rather
   than as configured.**

   **Per-route conformance, 2026-09-21.** `POST /api/tasks` now binds `poster`
   to the session with `ownerRefusal`, which ignores the switch: no session, a
   session for another wallet, and a `dev_` poster are all refused 403 before any
   store read or write. Only an `agent:` poster skips it, because that string
   cannot name a wallet; its privilege lane is still dormant behind
   `SEED_AUTH_ENFORCE`. Guard: `tasks-route-poster-auth.test.ts`.
5. **AI proof never earns — and a flag never earns MONEY, ever.** A
   `flag`/AI-suspected verdict must not *automatically* award points, USDC,
   completions, reputation, leaderboard, or campaign progress. No random verdict
   (`verifyProofStub`) in production.

   **Amended 2026-09-03 — the human backstop.** A flagged proof may be cleared
   for POINTS ONLY by a quorum of qualified human judges
   (`src/lib/jury-appeal.ts`, guard `jury-appeal.test.ts`). This narrows the
   rule; it does not open the money path. `isAppealable` is the whole boundary
   and refuses any task that is not `rewardType: "points"`, or that carries an
   escrow tx, an `onChainId`, a Double-or-Nothing stake, an escrow-v2 address,
   or a `campaignId`. So invariant 2 (funded USDC releases ONLY through AI
   verification) and invariant 8 (campaign progress written ONLY by the
   verify-proof pass path) are untouched: a flagged FUNDED proof still earns
   nothing here and is resubmitted, disputed, or expires and refunds.

   Quorum is `APPEAL_QUORUM` (3) distinct judges, clearing on
   `APPEAL_CLEAR_MAJORITY` (2). A judge's vote counts only after
   `JUDGE_MIN_GRADED` (10) graded Real-or-Not cards at `JUDGE_MIN_ACCURACY`
   (60%) — the graded game, where the answer is known, is the qualification exam
   for the deck where it is not. Resolution is reserved with `SET NX` BEFORE the
   award so two judges landing the quorum vote concurrently cannot both pay.

   *Why the rule moved:* measured in production 2026-09-03, text proofs passed
   42/42 (100%) while photo proofs were flagged 22 of 50 (44%) — including
   proofs the verifier's own reasoning called "a genuine phone capture" and
   "real phone captures of flood conditions". The strict-by-design verifier was
   punishing real people for using a camera, and REAL OR NOT (2,868 human
   verdicts) was only ever shown proofs the AI had already passed. The one
   mechanism that could clear a wrongly-flagged photo was walled off from the
   only proofs that needed it.

   *Trap found by the guard test on its first run:* the refusal gate was written
   with `hasOnChainEscrow`, the strict CREDIT signal, which demands a real
   `0x`+64hex hash — so a task carrying an `onChainId` with no hash yet read
   "not escrowed" and slipped through. A refusal gate takes the LOOSEST signal
   (`isFunded`); only crediting takes the strict one. `reward.ts` says exactly
   this and it was still got wrong.
   **Amended 2026-10-05, three changes, all points only.**

   *(a) Human review of a flagged proof on a HOUSE favour*
   (`src/lib/house-review.ts`, gate `houseReviewScope` in
   `src/lib/house-review-gate.ts`). The appeal above refuses any task with a
   `campaignId` and any proof with no photo, and a house favour has no person as
   its poster, so these flagged proofs had nobody who could decide them. On
   5 Oct 2026 that was 8 Welcome favours and 28 written answers on production.
   The same qualified judges (10 graded cards at 60%), the same quorum (3,
   clearing on 2), each with a written reason, may now decide three kinds:
   `welcome_instance` (a per-person Welcome instance, photo or written),
   `welcome_source` (an original Welcome favour still held by an earlier
   person's flagged proof) and `house_text` (a written answer on a plain house
   favour). **`isAppealable` is unchanged** (it was moved, with the same logic,
   to `jury-appeal-rules.ts` so the proof screen can read it). The house gate
   is a second gate beside it, checked on the STORED row and never on a label
   from the request. It refuses: a poster that is not `agent:`, a sender that is not a wallet (a
   preview identity can hold no points, so a cleared decision could never be
   credited), a reward that
   is not points, an escrow hash, an `onChainId`, a Double or Nothing stake, an
   escrow-v2 address, a company piece, a hidden favour, every campaign except
   Welcome while it has no cash unlock, Welcome text that is not original, and
   any proof `isAppealable` already takes (one proof, one path). Invariant 2
   and invariant 8 are untouched: the file has no call that moves money and
   never calls `recordCampaignCompletion`.

   A flagged proof is shown ONLY to a qualified judge. An unqualified signed-in
   person gets a count and their own record, and no note, photo or favour text.
   No sender's wallet is sent to anyone.

   Votes are bound to one exact proof (`houseCaseKey`: the favour, the sender,
   the proof id and the proof content), so a new proof starts a new case. Once
   three votes are in, no fourth is taken, so a late vote cannot flip a
   decision.

   **The reviewer's decision is bound to the proof they were shown.** A card
   names the favour, and the sender may replace the proof while a reviewer has
   the card open. Each dealt card carries `proofToken` (`houseProofToken`, the
   hashed half of the case key, with no wallet and no proof text in it). The
   vote must send it back. Under the verify lock it is compared with the proof
   on the favour NOW, before any vote is counted and before any resolution step
   runs. A missing or old token answers 409 `stale` and changes nothing.

   **Order at resolution, and three single operations.** The first draft
   reserved the resolution before taking the completion slot, so a store that
   could not answer left a proof "cleared" with no points, for good. The second
   draft took the slot (SADD) and noted it for the case in two commands. On a
   real Redis, with the SADD applied and its response lost, the retry read the
   slot as someone else's and cleared with 0 points. A write whose answer never
   arrives must be recognisable as your own. Now:
   1. The slot AND the case's marker of it are ONE script
      (`CLAIM_SLOT_FOR_CASE`). A retry reads back what this case did.
   2. The credit is ONE compare-and-set script, keyed by the case
      (`creditCompletionStrict`, `COMMIT_KEYED_CREDIT`). The read is strict
      (`jsonSnapshot`, never the display reader, which answers a zero profile
      when the store fails and would let a write replace a person's whole
      points profile). The write lands only if the profile is still the exact
      bytes that were read and the wallet lock is still held. The ref is saved
      in the same write as the points. The credit goes to the wallet string
      exactly as the favour holds it.
   3. The History row AND its marker are ONE script (`RECORD_HISTORY_ONCE`), so
      a marker cannot exist without its row.
   4. The favour's own row (an instance is completed or reopened; a shared row
      goes through `posterConfirm`).
   5. Only then the resolution marker, and the case leaves the queue.
   Any failure, before or after a write landed, answers 503 `retry` with words
   that do not claim nothing was written. Every step run again changes nothing
   it already did, and the last judge may call again to finish a decision their
   vote already closed. The earlier "known limit" (a credit lost between two
   writes) is closed by step 1.
   Tests: `sol-house-review.real-redis.test.ts` runs the real Lua on a real
   Redis and throws away the answer AFTER each of the three scripts applied
   (opt in with `FAVOUR_REAL_REDIS_TEST=1`); the same cases run on the
   in-memory double in `welcome-two-participants.test.ts`.

   *(b) A resolved appeal settles the favour.* `POST /api/jury/appeal` used to
   move points and leave the favour `claimed` with its flag, so a favour many
   people could answer stayed held by one decided proof. The quorum vote now
   applies `posterConfirm`, the transition the poster's own decision uses.
   `isAppealable` has already refused every favour with money on it, and
   `posterConfirm` refuses anything not still claimed and flagged. No credit is
   written by the settle step. Test: `appeal-settles-favour.test.ts`.

   *(c) A service failure is not a verdict.* When the check could not run on a
   POINTS favour (no key, limit spent, or the call threw), the route stored a
   `flag` with confidence 0. A person read "flagged" about a proof nothing had
   looked at, and a shared favour was held by it. A points favour now gets 503
   `check_unavailable`, no verdict, no notification and no hold
   (`releaseUncheckedProof`). **Money is excluded on purpose:** a favour that is
   funded, escrow-bound, Double or Nothing or escrow-v2 keeps the old behaviour
   exactly. It is flagged and waits, because an outage must never release or
   reopen a funded favour. Tests: the "service failure" block in
   `welcome-two-participants.test.ts`, which also pins the funded case.

   *Per-person Welcome instances and invariant 4.* An instance belongs to one
   wallet. `POST /api/welcome/start` and `POST /api/verify-proof` both prove the
   wallet with `ownerRefusal` (unconditional, not the switch), and verify-proof
   refuses any other submitter on an instance, the admin bearer included.

6. **One escrow funds one payout.** Funded tasks are single-completion.
   Enforced twice since 2026-10-05. At creation, `POST /api/tasks` refuses a money
   favour with `maxCompletions` above 1. In the store, `isSinglePayout`
   (`src/lib/store.ts`) makes every pass path complete a favour once when there is
   money anywhere on the record (a reward that is not points, an escrow id, an
   escrow hash, a Double or Nothing stake), whatever `maxCompletions` says. That
   covers `completeTask`, the follow-up pass, poster approval and dispute
   approval. Before, the creation check alone kept the reopen path away from
   money, and the seed route or a hand edit could write a record that broke it.
   A follow-up verdict and a dispute verdict apply only to a favour that is still
   claimed, and their routes credit nothing when the store refuses the verdict.
   Tests: the single payout block in `store.test.ts`, `late-pass-history.test.ts`.
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

  **This rule has now failed FOUR times, including twice after it was written.**
  Jul 4 points-as-dollars (fix shipped clean; $278 of phantom USDC sat in prod for
  13 days and `/api/reputation` served it publicly), Jul 12 escrow bind (~$7), Jul 15
  unlock ($8 owed to 4 real wallets, gate never fired once), Jul 15 rep levels (0/33
  Orb users correct). The rule is not the gap — **nothing enforces it**. Until
  something does, treat every money/identity/reward fix as incomplete until you have
  run the count of violating rows. A rule with no gate is a wish.
- **Verify an ABSENCE with a positive control.** "No record" is not "did not happen".
  Jul 17: three tasks with no `settlementTx` looked unpaid; all three had actually
  been paid on-chain and one claimant was our own `DEPLOYER_KEY`. Worse, the first
  log scan reported "0 transfers" for a wallet paid 4 times that morning — the RPC
  rejects `eth_getLogs` and the probe swallowed the error. Before reporting an
  absence: prove the instrument sees a KNOWN presence in the same window, and never
  write `.catch(() => [])` in a probe. Ask the chain, not the app's copy of it.
- **A guard that restates the code is decoration.** Mutation-verify every new guard:
  break the real code, watch it go red, revert, and say so in the commit. A rule test
  that re-declares the predicate inline stays green through any change to its caller
  (that is why `verify-proof-credit-wiring.test.ts` exists next to
  `earned-usdc-credit.test.ts`). Beware the vacuous pass — assert the VALUE, never
  that two runs agree.
- `tsc` + `next build` + guard test green before merge.
