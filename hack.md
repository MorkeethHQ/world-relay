---
doc: hack
project: FAVOUR — exhausted jury → expressive points return bridge
phase: NOW
canonical: true
last-touched: 2026-09-06
starting-ref: aac00fdc619641dd08c397f21eee4f725fa12a1e
branch: cursor/favour-jury-return-bridge-2026-09-06
---

# FAVOUR — hack.md (contract for this build)

## NORTH STAR
When a juror finishes every proof available to them, the app tells the truth about why the deck stopped and one-taps them into an expressive points favour that can mint the next proof — then they can return to jury.

## PROMISE LINE
A signed-in juror who exhausts their personal deck gets a server-selected **points-only** feedback/review favour they can claim in one tap; the whole loop never grades appeal cards, never moves money, and never pretends a personal exhaustion is a global empty pool.

## OPEN QUESTIONS
- (non-blocking) Exact copy tone for the bridge CTA — ship plain truthful wording; Oscar can edit.
- (non-blocking) Competing branch `night-run/2026-08-31-jury-loop` is not on the remote; reimplement from the brief, do not invent its API.
- (blocking: none) Availability kinds and eligibility rules are specified in the brief.

## CONSTITUTION
1. Never change payout, settlement, campaign-progress, or appeal-award rules.
2. Opaque jury answers stay server-side; session ownership and judged-proof dedup stay.
3. `recordJuryVerdict` still rejects `answer.appeal`; `jury-appeal.ts` money exclusions untouched.
4. Bridge favour is points-only — refuse usdc / usdc-v2 / funded / on-chain / escrow / campaign / Double-or-Nothing / claim-code / own post / travel / non-expressive.
5. A checkbox is true only when its done-when was RUN. Say the command.
6. No merge to main, no production deploy, no fabricated live metrics.
7. Do not reorganise the repo; narrow bridge only.

## PLAN (risk-first)
1. **Pure availability + eligibility** — wrong empty/exhausted or a money-shaped bridge is the catastrophic miss. Done-when: unit tests RUN on `assessJuryAvailability` / `isJuryBridgeEligible` including money exclusions.
2. **GET /api/jury shape** — return `{ cards, availability, bridgeFavour? }` without leaking answers. Done-when: route/lib tests RUN for exhausted+bridge and empty vs exhausted.
3. **JuryMode one-tap claim** — truthful copy + claim → proof via existing endpoint. Done-when: component/route tests or browser journey RUN, or honest BLOCKED.
4. **Receipt + draft PR** — `docs/CLOUD-RECEIPT-favour-jury-return-2026-09-06.md`, typecheck+build green, small draft PR.

## NOW
Slice 1: pure availability (`deck` | `exhausted` | `empty`, compose floor = 2) + bridge eligibility, then wire GET + UI + tests in the same slice because the time box is 25 minutes and the acceptance cases demand the full narrow path.

## LOG
- 2026-09-06: HEAD confirmed `aac00fd…12a1e`. Branch created. Competing branch absent on origin (fetch failed). Reading jury.ts / route / JuryMode / appeal / tests.
- Implemented pure availability + bridge eligibility + `issueJurySession`; wired GET + JuryMode + Feed.
- Ran: `npx vitest run src/__tests__/jury.test.ts src/__tests__/jury-appeal.test.ts` → 52 passed.
- Ran: `npx tsc --noEmit` → 0.
- Ran: `npm run build` → 0.
- Browser claim→proof **BLOCKED**: no Redis in cloud; `claimTask` no-ops without store.
- Receipt: `docs/CLOUD-RECEIPT-favour-jury-return-2026-09-06.md`.
