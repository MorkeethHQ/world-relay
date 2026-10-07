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
  points-journey funnel) > other points > feedback > stale (see R17 for what stale means).
  Within a tier: non-feedback before feedback (a campaign's question-tasks must
  not be its first cards), then urgent (deadline < 4h, or funded bounty ≥ $15 —
  points amounts are never urgent), then proximity, then newest.
- **Curation.** Identical descriptions collapse past `DUPLICATE_DESC_CAP` (2); stale
  favours leave the default list (R17); the board caps at `BOARD_CAP` (30). The user's own posts/claims are never hidden by
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
  state. Only `scripts/hide-item.mjs` writes it. Every command is a dry run until
  `--apply`, and that includes `--undo` (since 5 Oct 2026: undo used to write at
  once). `--apply` does nothing without `--confirm <code>`, and the code is printed
  only by the dry run of the same command against the same store. It works once,
  for 30 minutes. The first line of every run names the store. A hide saves the prior record to `hide:backup:<key>` and writes by
  compare-and-set, so it fails instead of overwriting a record that changed under
  it. Undo restores the hidden state saved before the last hide, which may itself
  be hidden; no API route does, and a guard test pins that. A hidden task leaves
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

- **R17, a favour nobody answered in a week leaves active discovery (added Oct 4, 2026).**
  Measured on the live board on 4 Oct: 15 open favours, all with `maxCompletions`
  100, 9 of them older than 7 days with 0 accepted replies. None could reach the
  STALE tier, because `isStale` skipped every multi-reply favour. The "Open a
  while" chip never showed either.
  **Stale now means:** open, no claimant, older than `STALE_AFTER_MS` (7 days), and
  either single-reply, or multi-reply with `completionCount` 0. A multi-reply
  favour is exempt when it has at least one accepted reply, or when it belongs to
  a house campaign (`campaignId`), which has its own banner and end date.
  **What happens to a stale favour.** It ranks in the STALE tier (server and
  client). On the client it is left out of the default list while the list has
  `STALE_FILL_FLOOR` (8, equal to `BOARD_MIN_OPEN`) fresh cards. With fewer fresh
  cards, stale ones fill the list up to 8, after the fresh ones. The viewer's own
  posts are never hidden.
  **What does not change.** Nothing is deleted, hidden or expired by this rule. A
  stale favour stays in `GET /api/tasks`, opens by its link, can still be
  answered, and reaches history through the expiry cron (14 days) as before.
  `isBoardVisible` and `countOpenVisible` are unchanged, so the refill target and
  the floor signal still count stale favours as open supply. Whether stale
  supply should count toward the refill target is a separate decision.
  The daily mission and the starter card still pick through `isBoardVisible`
  only, so either may still pick a stale favour.
  Code `isStale` and `curateBoard` in `src/lib/board-rank.ts`; the card chip in
  `Feed.tsx` calls the same `isStale`. Test: the R17 block in `board-rank.test.ts`.

- **R18, ended campaigns are history, not cards (added Oct 4, 2026).**
  **Company campaigns.** `campaignEnded` (`src/lib/company-door.ts`): a published
  campaign has ended when every one of its piece tasks is closed (expired,
  cancelled, completed, failed, or open past its deadline). A claimed piece keeps
  it running. A piece missing from the task list is unknown, and unknown is not
  ended. `rankCampaignCards` now returns `lead`, `rest` and `ended`; the board
  renders `lead` and `rest` only. This amends R16's "demoted, never dropped": a
  campaign nobody can join is no longer a demoted card. It is not deleted or
  hidden. `GET /api/campaigns/company` still returns it, its page still opens and
  says "This campaign has ended.", and delivered pieces stay in History.
  Measured on production on 4 Oct: 2 published campaigns, 6 piece tasks, all
  expired on 28 and 29 Sep with 0 accepted pieces, both still listed under "More
  company campaigns".
  **House campaigns.** `getFeaturedCampaign(now)` returns the first `featured`
  campaign that is still running (`isCampaignRunning`, by `endsAt`). It used to
  return the first flagged entry whatever its dates, which on 4 Oct was
  `comeback-2026` (ended 30 Sep), so the FEATURED tier pointed at a campaign with
  no open task. It now points at `first-favour`.
  **A late pass reopens a multi-reply favour.** `settleLatePass` in
  `src/lib/store.ts`: when a flagged proof is accepted later (follow-up answer,
  poster approval, dispute mediation) on a favour with `maxCompletions` above 1,
  the reply is counted, the person's completer slot is taken, and the favour goes
  back to open while slots remain. Before, one late pass set a 500 or 1000 reply
  favour to completed for good (live: task 3580445b at 25 of 500).
  **Not fixed by this rule.** A flag still holds a multi-reply favour for one
  person until somebody resolves it, and agent-posted favours have nobody who
  does. On 4 Oct that held 44 favours, including all 8 welcome journey tasks.
  Tests: `ended-campaigns.test.ts`, and the late pass block in `store.test.ts`.

- **R19, campaigns are the front door, and Welcome is done per person (added Oct 5, 2026).**
  Oscar, 5 Oct: "The company campaign is the main thing, we've lost the best ones
  we had, WELCOME campaign, onboard etc."
  **What was measured.** Public `GET /api/tasks` on production, 5 Oct: 13 rows
  carry `campaignId: "first-favour"`. 8 are the original Welcome favours (posted
  5 Jul, 1000 replies each). All 8 were `claimed`, each with one earlier person's
  flagged photo. A shared row holds one proof at a time, so no new person could do
  any Welcome favour, and the campaign banner (which needs an open task) never
  showed. Welcome was not deleted. It was held.
  **The stage.** `pickCampaignStage` (`src/lib/campaign-stage.ts`) puts three
  rungs above the daily mission, in one order, on the board and on the signed-out
  first screen (`CampaignStageCards`):
  1. **Welcome**, the original `first-favour` campaign. Its id, its end date
     (31 Dec 2026) and its ten task texts are unchanged (`welcome-shape.ts`; a test
     compares the texts with `scripts/first-favour.json`).
  2. **A real company campaign**, only the one `pickCampaignToDo` returns. R16 is
     unchanged: checked by hand, a real brief and product, a piece open. When none
     qualifies the rung says so and offers nothing.
  3. **A demo brand** (`src/lib/demo-brand.ts`). Fictional and labelled so. It is
     not in `CAMPAIGNS`, has no task rows and no pot, and cannot be started. Its
     amounts are proposals, printed in full (0.001 reads 0.001).
  This amends R13: the stage leads and the daily mission follows it.
  **Welcome per person.** A Welcome step is done on a per-person instance
  (`ensureWelcomeInstance`, `src/lib/welcome-journey.ts`): a private copy of the
  source row, bound to it by `welcomeSourceId` and to one wallet by `welcomeFor`.
  Someone else's pending or flagged proof sits on their own instance. The source
  rows are not reopened, edited or deleted, and the earlier claims stay.
  An instance is kept out of the shared task list by the store (it is indexed
  under its owner), so the board, the stats, the jury deck and the crons never see
  one. Only its owner may submit to it. A pass takes the person's slot on the
  SOURCE row, so a step is credited once per person.
  **An open Welcome source row is not a board card** (`isBoardVisible`), is not
  claimable, and takes no direct proof (`welcome_instance_required`). It is reached
  through the stage, like a company piece under R15, and does not count as board
  supply. The earlier person whose proof is on a held row still sees it and may
  send a new proof there. Their held proof can be decided by qualified reviewers
  (`house-review.ts`); the row changes only when three of them decide it.
  **A source row** is an original Welcome text, posted by a house agent, points,
  multi-reply, open or claimed, with no money on it (`isWelcomeSourceRow`). The
  two Welcome favours that expired on production stay expired.
  **House campaign banners.** A campaign past its end date is never a current
  banner, whatever is still marked open under it.
  **One review entry.** The board has one door to reviewing, `ReviewEntryCard`
  ("Review favours"). It replaces the "Review a proof" card and the REAL OR NOT
  banner, which both opened the same deck. Flagged proofs that need a human
  decision are reached from inside it.
  **Polls.** On the Polls page open polls lead, a question you have not answered
  first (`splitPolls`, `src/lib/poll-view.ts`). Closed polls and resolved
  predictions are history behind one control each. Measured the same day: 3 open
  and 27 closed polls, and 180 predictions of which 176 were resolved, all printed
  as full cards. R2 and R9 are unchanged.
  Code: `campaign-stage.ts`, `welcome-shape.ts`, `welcome-journey.ts`,
  `demo-brand.ts`, `review-entry.ts`, `poll-view.ts`. Tests:
  `campaign-first.test.ts`, `welcome-two-participants.test.ts`.

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

R16 rendering clarification (2026-10-03): unverified company cards remain below the favour list even when that list is empty. A company-only board must still expose its published campaigns; this does not make an unverified company eligible to lead.

## R20 — Campaign focus, 7 October 2026

Oscar asks for real campaigns, removal of old betting and a cleaner product.
This supersedes R10 and the demo rung in R19. Checked, doable company campaigns
lead when present; the real Welcome journey remains available. Fictional brand
examples leave the front door. Campaign creation replaces the generic header action.
No new predictions or stakes may be created through the API. Football sync only
settles existing predictions; its schedule remains for those obligations. Old
results and pending stakes remain behind the archive control on Polls.
New Double or Nothing favours are refused; existing rows remain reachable by
link and visible to their poster or claimant. Settlement logic is unchanged.

The campaign board no longer interleaves daily quizzes or poll rails. Polls remain
in their own tab. One-off favour composition is behind one disclosure.
