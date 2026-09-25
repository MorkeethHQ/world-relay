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
  **Escrow-v2 amendment (Jul 31, 2026):** an open `usdc-v2` task is visible while
  UNFUNDED — that is the demand-gated design working, not a broken promise: the
  poster funds the verified FavourEscrowV2 contract from their own wallet at
  claimant-accept, and the badge shows the honest "funds on accept" state until
  the server verifies the escrow on-chain. Funded v2 tasks rank in the FUNDED
  tier like any real-money task; unfunded ones rank with points. The whole rail
  is dark unless `ESCROW_V2_ENABLED=1`; launch caps are env-configurable and
  UNLIMITED by default (`ESCROW_V2_MAX_USD`, `ESCROW_V2_MAX_CONCURRENT` — 0 or
  absent = no cap; server-enforced in `/api/tasks` and `/api/escrow-v2`, config
  source `src/lib/escrow-v2.ts`).
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
- **R6 AMENDED Sep 16, 2026: the engine is OFF and the floor is a signal.**
  The paragraph below describes the engine as it was built and how it still
  behaves if re-enabled. Read this first.
  **What changed.** The visible open board no longer self-heals. Measured on the
  live app 16 Sep: **24 of the 25 open favours shared a single timestamp from one
  replenish run twelve days earlier**, not one of them was at a real place, and
  agent-posted favours had produced 19 completions across 74 tasks against 460
  across 105 human ones. Oscar's ruling that day: *"Favour has a lot of stale
  boring items still"*.
  **What OFF means, and it is both halves.** The cron entry is removed from
  `vercel.json`, so nothing is scheduled, and the handler is gated behind
  `BOARD_REPLENISH_ENABLED` which defaults to **false**, so a manual call, a
  restored schedule or a fresh deploy cannot quietly refill the board. A caller
  who arrives anyway gets an explicit `disabled: true` receipt naming the ruling,
  and a `console.warn`, rather than a successful-looking empty receipt. A job
  that silently does nothing is indistinguishable from a job that ran and found
  nothing to do, and removing that ambiguity is the point.
  **The default direction is deliberate.** `SESSION_ENFORCE` in `session.ts` uses
  the same env-switch shape but defaults to the permissive side, which is why an
  identity invariant has sat dormant in production for months. This one defaults
  to the safe side: forgetting the variable means no posting. A guard test pins
  that only the exact string `"true"` enables it.
  **`BOARD_MIN_OPEN` (8) is now a signal, not a promise.** Nothing automatic
  maintains it, so it means "the board needs a human to post", and it is surfaced
  as `tasks.belowFloor` on `/api/stats` next to `tasks.floor`. `isBoardBelowFloor`
  counts what a visitor can actually see, not `status === "open"`.
  **To re-enable:** set `BOARD_REPLENISH_ENABLED=true` and restore the cron entry.
  Both, or it will not run.
- **R6 original, supply floor (added Jul 29, 2026).** The visible open board never sits
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
- **R8 — Recycle can never take a whole replenish run (added Sep 3, 2026).**
  At most `RECYCLE_MAX_SHARE` (0.5) of each run's budget may come from recycled
  expired favours; the rest is fresh supply. Context: `planReplenish` filled its
  budget from recycle candidates first and only generated the remainder. A live
  board always has expired points favours, so the remainder was structurally
  zero — on Sep 3 all 8 open favours were verbatim `FALLBACK_FAVOURS` entries
  and the same ten descriptions had rotated on and off the board since Jul 30.
  The floor (R6) was being met by a treadmill. Exception: a 1-slot run stays on
  recycle rather than forcing a model call. Code `src/lib/board-replenish.ts`,
  test `board-replenish.test.ts`.

- **R9 — The poll list has a supply floor too (added Sep 3, 2026).**
  The active poll list never sits below `POLL_MIN_ACTIVE` (4). Engine
  `src/lib/poll-refresh.ts`, cron `/api/cron/poll-refresh` (07:15 daily), guard
  test `poll-refresh.test.ts`. Caps: `POLL_MAX_PER_RUN` (3),
  `POLL_MAX_PER_DAY` (6); editorial polls run `POLL_DURATION_HOURS` (168) not
  the 72-hour user default; a question is not re-asked for
  `POLL_REASK_COOLDOWN_DAYS` (45). Context: nothing on the server had ever
  created a poll. Polls were user-generated only, and on Sep 3 the tab held 12
  polls of which exactly **one** was still active — six of the dead ones about a
  World Cup that ended Jul 19 — leaving the feed's poll rail (active-only) a
  single card, and nothing at all once that last user poll lapsed hours later.
  R2 governed where polls rank; no rule governed whether any existed.
  The pool is evergreen **by test**: a fallback poll may not name a date,
  season, tournament or year, because that is exactly how the last batch died.
  Ended polls are honest history and are NOT deleted — the UI files them below
  the active ones. Spam is removed by id through `/api/admin/polls`.

- **R10 — A seasonal data source is never the only source (added Sep 3, 2026).**
  Predictions are fed by `FOOTBALL_LEAGUES` in `src/lib/football.ts`. That list
  was `["fifa.world"]` alone; from Jul 20 (the day after the final) ESPN
  returned zero events, so the hourly `football-sync` cron created nothing for
  46 days and every prediction on the board read "Resolved". It now pulls six
  year-round domestic/continental leagues. Add a tournament league for its
  window; never remove the year-round ones when it ends. Supply is capped in
  the cron (`MAX_CREATE_PER_RUN` 4, `MAX_OPEN_PREDICTIONS` 12, soonest kickoff
  first) so six leagues cannot bury the tab or split the points pools too thin.

- **R7 — Jury-first empty board (added Jul 29, 2026).** If the available board
  is ever empty anyway, the empty state leads with the REAL OR NOT judge CTA —
  the one surface that cannot run out of supply — instead of a dead end. Same
  redirect the seed-cap wall uses (`seed-caps.ts`, cd963d0).

- **R6 amended again (Sep 21, 2026): the board refills itself, behind a quality gate.**
  Oscar: "right now we just REFRESH the favours once again, we need to have infinite
  ones." The replenish engine is back on (`BOARD_REPLENISH_ENABLED=true`, cron hourly),
  topping up toward `REPLENISH_TARGET_OPEN` = 15 open favours. The reason it was
  killed on Sep 16 (one run posted 24 of 25 open favours, stale and samey) is what the
  gate now prevents: no ask returns if it, or a near-duplicate (`isNearDuplicate`,
  content-word overlap >= 0.6), was on the board in the last 14 days in any state;
  a recycled ask must have been off the board for 14 days; kinds rotate, with no
  category taking more than half a run and the thinnest categories first; model calls
  are capped per day (`MODEL_CALLS_PER_DAY`), then the curated pool. Every generated
  ask is posted by a named agent, points only; money fields cannot be set. Expiry runs
  hourly. `BOARD_MIN_OPEN` (8) stays as the "a person should post" signal.

- **R13 — The daily mission leads the first screen (added Sep 20, 2026).**
  Ruling, Oscar: "Make the first screen a rotating daily mission and completed
  proof-image strip; creation stays secondary", and "supply the great favours
  ourselves". `pickDailyMission` chooses ONE open points favour per UTC day, the
  same one for everyone on earth that day, and the board follows underneath it.

  Eligibility is a PREDICATE, not a score: a mission must be SENSORY (smell,
  taste, sound, touch, temperature) or about the answerer's own HERE AND NOW
  ("where you are", "near you", "right now"). Scoring only orders the eligible,
  by those two rules first, then reachability (remote location, agent-posted,
  a 5-25 points band). The first draft used a numeric bar and an ordinary remote
  agent errand cleared it, which is the exact filler the board is moving away
  from, so the traits that make a favour REACHABLE must never substitute for the
  traits that make it WORTH LEADING WITH.

  Rotation is inside the top-scoring group, indexed by a hash of the UTC date.
  When one favour is the unique top scorer it holds the slot until the supply
  changes. That is a property of the supply, and the repair is to author more
  signature favours, never to weaken the rule.

  It returns null rather than promoting a favour with no signature quality, and
  it never offers a money favour, the caller's own post, or one they already
  claimed. The measurement behind it, live board 2026-09-20: the deployed
  selector showed a stranger "What's the last thing that made you laugh out loud
  today?" while "what does today smell like where you are?" sat below the fold,
  and 0 of 9 open cards carried a proof image while 29 completed records did.

  Only one "start here" card ever renders: when the mission shows, the first-run
  starter banner is suppressed, because two suggestions are two decisions before
  anything gets done.

- **R14 — The proof strip is real completions only (added Sep 20, 2026).**
  `pickProofStrip` takes completed favours that carry a real proof image, capped
  at `PROOF_STRIP_MAX`, and excludes `dev_`/`demo_`/`e2e_` posters and claimants
  the same way `isPublicTask` does. It renders nothing when there is no real
  proof rather than degrading into decoration. The strip's whole claim is "people
  did this", so a placeholder in it would be fabricated evidence of use, which
  CLAUDE.md forbids outright.

- **R15 — A company campaign piece is not a favour (added Sep 22, 2026).**
  `isCompanyPiece` (a task with `companyCampaignId`). An open piece is kept off
  the favour list, the starter pick and the daily mission (`isBoardVisible`), and
  it does not count toward the refill target (`countOpenVisible`). Pieces are
  reached through the "Do a piece and earn" card and the campaign cards, which
  show whether the company is checked. Measured on production on 22 Sep: 9 of 21
  open tasks were pieces from three campaigns, so they filled the refill target
  with work that was not favours, held the generator at zero, and put
  9 unlabelled rows such as "kcz sdn,bhd campaign · just want to make money" at
  the top of the favour list. A piece someone has claimed still shows to them.

- **R16, only a real, doable, checked item may lead (added Sep 25, 2026).**
  A stranger test on 25 Sep found the first card a new visitor saw was
  "kcz sdn,bhd · just want to make money": an unverified company, a 5-word brief,
  no product, so no piece could be joined. Trust died in 12 seconds. The cause was
  in `Feed.tsx`: every published campaign rendered as a full card above the
  favours, newest first, with no rule at all.
  **Campaigns.** `canLeadCampaign` (`src/lib/company-door.ts`): a campaign card may
  sit above the favour list, or be the "Do a piece and earn" card, only if it is
  not hidden, the company is checked by hand (`companyChecked`), it passes today's
  publish gate (20-word brief, product name and link), its brief and name are not
  a money pitch (`looksLikeSpam`), and the viewer can do one of its pieces now.
  `rankCampaignCards` returns `lead` (above the favours) and `rest` (below the
  favour list, under "More company campaigns", still labelled with trust).
  Demoted, never dropped. `pickCampaignToDo` offers only a campaign that may lead,
  so an unverified company is never the signed-out first screen's main action.
  **Favours.** `leadWithDoable` (`src/lib/board-rank.ts`): the first favour card is
  one this viewer can do (open with room, not their own post, not already
  delivered by them, not a money pitch), or their own claim. Only that card moves;
  the rest keep their order. A money pitch is left out of the default list
  (unless it is the viewer's own), and the starter card and the daily mission
  skip it too. The one allowed non-doable lead: a board whose only cards are the
  viewer's own posts, which only that viewer sees. A hidden piece does not count
  as an open piece of its campaign. An open favour with no room left is not board-visible.
  **Moderation.** `hiddenAt` on a task or a campaign is the operator's hidden
  state. Only `scripts/hide-item.mjs` writes it (dry run by default, `--apply`,
  `--undo`); no API route does, and a guard test pins that. A hidden task leaves
  every public read: `GET /api/tasks` (`isPublicTask`), `/api/tasks/search`,
  `/api/agent/tasks`; `/api/tasks/[id]` and `/api/agent/tasks/[id]` answer 404,
  and the task page's link preview drops its text (`isHiddenTask`; route test
  `hidden-routes.test.ts`). The script itself is tested against a fake KV in
  `hide-item-script.test.ts`. It also leaves the board, the starter card and
  the daily mission. A hidden campaign leaves
  `GET /api/campaigns/company`, its detail route answers 404, and its piece tasks
  are hidden with it. `getPublishedCampaign` still resolves it, so a proof already
  in flight keeps its label. Hiding is never deleting.
  **Not done.** Favour poster verification is not part of R16: the task record
  carries no poster verification level, and every open favour on 25 Sep was
  posted by a house agent. Test: `src/__tests__/lead-card.test.ts`, whose fixtures
  are the three campaigns production served that day.

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
