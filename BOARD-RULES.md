# FAVOUR board rules

What shows on the task board and in what order is a written, tested rule set,
not per-component vibes (same discipline as SECURITY-INVARIANTS.md). The code
is `src/lib/board-rank.ts`; the guard test is `src/__tests__/board-rank.test.ts`.
Change all three together or not at all.

Context (Jul 5, 2026): the live board had 3 open tasks, 2 of them question-type,
plus 2 poll cards rendered above the list — a visitor's first screen was mostly
polls. Nothing in the code governed the mix. These rules exist so that can't
recur silently.

## Rules

- **R1 — Feedback share cap.** At most `FEEDBACK_MAX_IN_WINDOW` (3) feedback-category
  tasks among the first `FEEDBACK_WINDOW` (15) cards. Overflow is demoted below the
  window, never dropped. The user's own posts are exempt.
- **R2 — Polls never lead.** Poll cards render after the first `POLL_INSERT_AFTER` (3)
  task cards, capped at `POLL_CARDS_MAX` (2). On an empty board they render below the
  empty state.
- **R3 — Visibility is earned.** An open task shows only if it is a points task or
  escrow-funded on-chain (`isRealMoney`). No category exceptions (the old
  `feedback` bypass let unfunded USDC question-tasks onto the board). Claimed tasks
  show only to their claimant.
- **R4/R5 — Tier order.** my claims > funded USDC > featured campaign (the current
  points-journey funnel) > other points > feedback > stale (>7 days unclaimed,
  SINGLE-completion tasks only — evergreen multi-completion tasks reopen after
  every pass and never rot by age).
  Within a tier: non-feedback before feedback (a campaign's question-tasks must
  not be its first cards), then urgent (deadline < 4h, or funded bounty ≥ $15 —
  points amounts are never urgent), then proximity, then newest.
- **Curation.** Identical descriptions collapse past `DUPLICATE_DESC_CAP` (2); the
  board caps at `BOARD_CAP` (30). The user's own posts/claims are never hidden by
  any cap.
- **R6 — Supply floor (added Jul 29, 2026).** The visible open board never sits
  below `BOARD_MIN_OPEN` (8). The replenish engine
  (`src/lib/board-replenish.ts`, cron `/api/cron/replenish-board`, guard test
  `board-replenish.test.ts`) restores supply in two steps: recycle expired,
  seeded, never-claimed POINTS favours (7-day per-description cooldown), then
  generate fresh points favours (model call with a deterministic fallback pool).
  Caps: `REPLENISH_MAX_PER_RUN` (6), `REPLENISH_MAX_PER_DAY` (12). **Points
  only, by construction**: the engine has no code path that can set
  `onChainId`, `escrowTxHash`, or `rewardType: "usdc"` — money favours stay
  human-funded and escrow-bound. Context: on Jul 28 the board held 2 open of
  121 tasks with 26% expired unfilled, because expire-tasks removed supply
  daily and nothing ever added it.
- **R7 — Jury-first empty board (added Jul 29, 2026).** If the available board
  is ever empty anyway, the empty state leads with the REAL OR NOT judge CTA —
  the one surface that cannot run out of supply — instead of a dead end. Same
  redirect the seed-cap wall uses (`seed-caps.ts`, cd963d0).

## Where each rule is enforced

- **Server (`GET /api/tasks` via `orderBoardForApi`):** R5 tier order + R1 feedback
  demotion, anonymously (no user identity/location server-side), reorder only —
  the API never drops a task. Agents and integrations get the same composition.
- **Client (Feed via `rankBoard`/`curateBoard`):** re-ranks with user context (own
  claims, proximity) and applies display caps: `BOARD_CAP`, duplicate collapse,
  R2 poll placement. Display caps stay client-side because only the client knows
  whose board it is (own posts are never hidden).

## Why these priorities

We optimise for the points journey now (welcome campaign = featured) and brand/UGC
next. Funded USDC outranks everything because real money is the product; feedback
tasks are useful but must never be the first impression.

## Change process

Propose the new threshold or tier explicitly (rules, not vibes), update this doc,
`board-rank.ts`, and `board-rank.test.ts` in the same commit.
