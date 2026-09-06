# CLOUD RECEIPT — favour jury return bridge (2026-09-06)

## Identity
- **Starting SHA:** `aac00fdc619641dd08c397f21eee4f725fa12a1e`
- **Branch:** `cursor/favour-jury-return-bridge-2026-09-06`
- **PR URL:** (filled after draft open)
- **Competing branch:** `night-run/2026-08-31-jury-loop` — **not on origin** (`git fetch` / `gh api` found no ref). Reimplemented from the brief; no cherry-pick.

## Changed files
- `hack.md` — seven-part contract for this slice
- `src/lib/jury.ts` — `assessJuryAvailability`, `isJuryBridgeEligible`, `pickJuryBridgeFavour`, `issueJurySession`
- `src/app/api/jury/route.ts` — returns `availability` + `bridgeFavour`
- `src/components/JuryMode.tsx` — exhausted vs empty copy; one-tap claim
- `src/components/Feed.tsx` — `onBridgeClaimed` → proof view
- `src/__tests__/jury.test.ts` — availability, eligibility exclusions, session, appeal rejection
- `docs/CLOUD-RECEIPT-favour-jury-return-2026-09-06.md` — this file

## Commands run (done-when)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npx vitest run src/__tests__/jury.test.ts src/__tests__/jury-appeal.test.ts` | **52 passed** (2 files) |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Build | `npm run build` | **exit 0** (Next.js compile OK) |
| HEAD at start | `git rev-parse HEAD` | `aac00fdc619641dd08c397f21eee4f725fa12a1e` |

## Behaviour shipped
1. Pure availability: `deck` | `exhausted` | `empty` with compose floor `JURY_COMPOSE_FLOOR = 2`.
2. `GET /api/jury` → `{ cards, availability, bridgeFavour }` (bridge at most one; null when deck playable or no eligible favour).
3. Bridge eligibility refuses: usdc / usdc-v2 / funded / on-chain / escrow-v2 / campaign / Double-or-Nothing / claim-code / expired / own post / travel coords / non-remote location / non-feedback|review / capped.
4. UI distinguishes exhausted (“available to you”) from empty (global pool); one-tap claims via `POST /api/tasks/:id/claim`; Back to favours kept.
5. Appeal card on graded `recordJuryVerdict` still errors; awards nothing (test added).

## Browser / claim journey
**BLOCKED (honest):** cloud env has no `KV_REST_API_URL` / Redis. `claimTask` requires Redis (`store.ts` returns null without it), so a cold claim → proof screen cannot complete here. Lib/API behaviour is covered by vitest; UI wiring is in `JuryMode` + `Feed` and typechecks/builds.

## Limitations
- No transplant from competing branch (absent on remote).
- Multi-completion “already completed by this juror” history is not persisted after reopen; eligibility only sees a same-id completed record when still present.
- Seed daily caps are enforced at claim time (existing route), not duplicated in the pure bridge picker.
- Draft PR only — no merge, no push to `main`.
