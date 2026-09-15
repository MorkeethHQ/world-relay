# CLOUD RECEIPT — verified consequence return (2026-09-15)

## Identity
- Base: `ee4d12637c6deb06e9950fcafb5ac298e92d3c67`
- Branch: `cursor/favour-jury-return-bridge-2026-09-06`
- PR: [#10](https://github.com/MorkeethHQ/world-relay/pull/10) (same existing draft)
- Final tested head: `d68117c` plus this receipt commit
- Coordination: the existing owner advanced the branch to `fb20855` during this run. No force-push or competing PR was created; that commit was retained and reviewed before the follow-up commits.

## Capability
A labelled wallet can claim the jury bridge favour, submit real evidence, see FAVOUR's authoritative verdict and confirmed points credit, receive one genuinely available next offer or an honest unavailable state, and later reopen the same chain under Profile.

## Evidence

| Check | Command | Result |
|---|---|---|
| Focused risk suite | `npx vitest run src/__tests__/jury.test.ts src/__tests__/jury-appeal.test.ts src/__tests__/jury-bridge-claim.test.ts src/__tests__/contribution-consequence.test.ts src/__tests__/store.test.ts src/__tests__/verify-proof-claimant-level.test.ts src/__tests__/verify-proof-credit-wiring.test.ts src/__tests__/invariants.guard.test.ts` | 8 files, 100 passed |
| Full tests | `npx vitest run` | 43 files passed, 1 skipped; 487 tests passed, 1 skipped |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Production build | `npm run build` | exit 0; 55 pages generated; `/api/contributions` present |
| Labelled API journey | `BASE_URL=http://127.0.0.1:3000 ADMIN_SECRET=local-secret node scripts/favour-consequence-journey.mjs` | pass; claim 200, verdict pass, 10 points, one history row, reclaim 403, bridge did not re-offer task |
| Labelled browser journey | `BASE_URL=http://localhost:3000 node scripts/favour-consequence-browser.mjs` | pass; claim → text evidence → authoritative pass → 10 points credited → honest no-next-favour → Profile receipt |
| Guard mutation | remove `hasCompletedClaimant` from `isJuryBridgeClaimOfferable`, run `npx vitest run src/__tests__/contribution-consequence.test.ts`, restore | red as expected: 2 reopen-exclusion tests failed; restored run 7/7 green |

The local journeys used `scripts/memory-kv-server.mjs`; it implements the Upstash REST commands reached by this app. Data was ephemeral and test-labelled. No production records, supply, users, campaigns, or money were touched. The first API run honestly returned `flag` and zero credit; after resetting the ephemeral store, the pass run above exercised the credited path. The browser run used the real local claim and verify routes with no browser response mocks.

## What changed
- Durable `completed_claimants:{taskId}` membership is written before a multi-completion row reopens; claim and jury offer paths both refuse prior completers.
- `/api/verify-proof` awaits the points-ledger write before reporting `pointsAwarded`; it does not predict credit from the bounty.
- Durable personal consequence rows preserve contribution, accepted evidence, verdict, credit, and next-action truth after the mutable task row clears.
- The pass screen renders the full chain. It promises a return only when another eligible bridge favour exists; otherwise it says none is available.
- Profile renders the user's durable “Because you helped” history.

## Value observation
- Value: **observed** — the browser returned the verified consequence and Profile retained it.
- Unaided: **observed locally** — the scripted labelled wallet completed the UI without internal state edits; production World App was not used.
- Distinctive: **partial** — verified human evidence plus durable consequence/return is present; comparative user preference was not measured.
- Action-return: **observed** — the only task was excluded after reopen and the UI honestly reported no other eligible favour.
- Access: **observed locally / untested in production** — wallet-labelled browser account passed; Orb/MiniKit production access was not exercised.

## State
- Built: yes
- Tested: yes, including browser and mutation evidence
- Pushed: yes, same PR #10 branch
- Reviewed: self-reviewed against money/reward invariants; no human review recorded
- Merged: no
- Hosted: preview CI not checked in this receipt; production not deployed
- Used: local labelled test account only; no real user notified

Largest gap: a real World App/Orb account against deployed Upstash and production AI has not exercised this return; no deployment or user notification was authorized.

## IDE repair 2026-09-15 (continuation)

Profile `ContributionHistory` now surfaces the stored next-action label (`Next — …`), matching Feed mini-history and the done-when line for return-to-consequence. Browser journey asserts that Profile row after the labelled pass.

Largest remaining gap unchanged: production World App/Orb against deployed Upstash/AI is still untested (no deploy/notify authorized).

