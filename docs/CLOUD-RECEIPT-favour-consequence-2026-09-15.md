# CLOUD RECEIPT — verified consequence return (2026-09-15)

## Identity
- Base: `ee4d12637c6deb06e9950fcafb5ac298e92d3c67`
- Branch: `cursor/favour-jury-return-bridge-2026-09-06`
- PR: [#10](https://github.com/MorkeethHQ/world-relay/pull/10) (same existing draft)
- Coordination: parallel cloud work on this branch was rebased together (no force-push, no second PR).

## Capability
A labelled wallet can claim a points favour (including the jury bridge), submit real evidence, see FAVOUR's authoritative verdict and confirmed points credit, receive one genuinely available next offer or an honest unavailable state, and later reopen the same chain under Profile and History.

## Evidence

| Check | Command | Result |
|---|---|---|
| Focused risk suite | `npx vitest run src/__tests__/contribution-consequence.test.ts src/__tests__/jury.test.ts src/__tests__/jury-bridge-claim.test.ts src/__tests__/jury-route.test.ts src/__tests__/store.test.ts` | 5 files, 64 passed |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Memory KV ping | `curl -X POST http://127.0.0.1:8079 -H 'Authorization: Bearer local' -d '["PING"]'` | `{"result":"PONG"}` |
| Labelled API journey | `node scripts/favour-consequence-journey.mjs` | `ok: true` — pass pts=8, evidence note+image, reclaim `403 Already completed`, bridge did not re-offer, naiveVsExclusion.winner=`exclusion` |
| History UI | labelled wallet → `/history` | “Because you helped” shows verified +8 pts + evidence + next action (screenshot `/opt/cursor/artifacts/history-because-you-helped.webp`) |
| Profile | ContributionHistory component | next-action label surfaced (prior commit on branch) |

## What changed
- Durable `completed_claimants:{taskId}` written before multi-completion reopen; claim + bridge offer refuse prior completers.
- `/api/verify-proof` awaits points-ledger write before reporting `pointsAwarded`; evidence captured from this submission (not cleared reopen row).
- Personal consequence ledger + `/api/contributions`; Profile + History + pass UI surface the chain.
- Bridge next action is honest: another eligible favour, or “none available”.
- Naive baseline arm in tests: shape-only re-offers completed reopens; exclusion wins.
- `scripts/memory-kv-server.mjs` + journey/browser scripts for cold labelled runs.

## Value observation
- Value: **observed** — labelled journey returned verified consequence; History retained it.
- Unaided: **observed locally** — scripted labelled wallet; production World App not used.
- Distinctive: **partial** — durable consequence/return present; comparative user preference not measured.
- Action-return: **observed** — prior completion excluded after reopen; UI/API report unavailable when no next favour.
- Access: **observed locally / untested in production**.

## State
- Built: yes
- Tested: yes (API journey + History UI + unit)
- Pushed: yes, same PR #10 branch
- Reviewed: self-reviewed against money/reward invariants
- Merged: no
- Hosted: production not deployed
- Used: local labelled test account only

## WRONG / gaps
- Evidence initially lost after reopen (finalTask cleared proof) — fixed.
- Create rate-limit (5/min) blocked early journey attempts — switched to KV seed.
- Feed “Mine” tab not in bottom-nav — History + Profile are discoverable surfaces.
- `/api/stats` 500 against memory-KV (platform totals strip only).
- Immersive jury swipe→exhaust→bridge click path not video-recorded in this pass.
- Production World App/Orb against deployed Upstash/AI untested (no deploy authorized).
