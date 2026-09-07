# FAVOUR: what a stranger sees today (frozen before)

Read from source on the worktree branch `night/2026-09-07-favour-ui`, base `7866d00`.
No server was started; this is a route-and-component read of the candidate source.
The same routes are used for the after.

## Routes read

| Route | File |
|---|---|
| `/` | `src/app/page.tsx` then `src/components/Onboarding.tsx` or `src/components/Feed.tsx` |
| `/polls` | `src/app/polls/page.tsx` |
| `/history` | `src/app/history/page.tsx` |
| `/dashboard` | `src/app/dashboard/page.tsx` |
| `/task/[id]` | `src/app/task/[id]/page.tsx` |
| `/agent/[id]` | `src/app/agent/[id]/page.tsx` |
| `/privacy`, `/terms` | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` |
| 404 | `src/app/not-found.tsx` |
| tab title / OG | `src/app/layout.tsx` |

## `/` first screen, browser, no stored state

Renders `Onboarding`, 5 steps.

- Step 0: the word `FAVOUR` at 64px, then "Pick a small task, do it, send proof, earn points."
  and "A favour is a quick real-world ask, like photographing a shelf or sharing an honest opinion."
  Then an eyebrow strip: `Favours · Polls · Points`.
- Step 1 "How it works": "Someone posts a small task. You do it, send proof, earn points when it passes."
  Three rows: Pick a favour, Do it and send proof, Earn points.
- Step 2: ground rules, links to full terms and `/privacy`.
- Step 3: sign in with World.
- Step 4: "You are all set."

**What a stranger cannot tell.** Every sentence is written to one role, the person who does the
work. "Someone posts a small task" is the only mention of the other side, and it does not say who
that someone is, that they are a company, that the ask recurs, or why they would come back. The
product is recurring company campaigns; the first screen never says the word campaign.

## `/` onboarded but signed out

`src/app/page.tsx` lines ~193-250. `FAVOUR` at 56px, then exactly:

> Real tasks. Real people.
> Verified on-chain.

then an eyebrow strip `Tasks · Polls · Campaigns`, then a `Sign in` / `Continue` button.

**What a stranger cannot tell.** Three noun phrases and three category words. Nothing states what
the product is, who asks, who does the work, or why either returns. This is the "lost landing page".

## `/` signed in

`Feed.tsx` (3516 lines). Header `FAVOUR` plus `New`. Then daily poll, a `REAL OR NOT` game banner over
`/hero/cyclist.jpg`, the line "Do a favour. Prove it. Get rewarded.", a counter row
(`open now` / `verified` / `paid out`) all computed from the loaded tasks, a liveness strip, then
campaign banners, then the `Favours` list.

The counters and the liveness strip are computed from real data, not invented. Campaign banners
render `campaign.heroImage` when present, and zero-task campaigns are hidden. Task cards render
`task.proofImageUrl` when a proof exists.

**Empty board.** `EmptyBoardTeach` (Feed.tsx ~124). When there are no favours the board does not say
it is empty. It renders a card badged `Example` containing a hard-coded `EXAMPLE_FAVOUR`
("Share one honest opinion about a product you used this week", `Online`, `5 pts`) with four steps.
The sample is honestly labelled, but the empty state fills itself with a sample instead of saying
what is missing.

## `/history`

Header, then a black block printing three totals from `/api/stats`: `paid out`, `points earned`,
`people reached`. On an empty platform this is a wall of three zeros. Completed cards below render
the real `proofImageUrl`. Empty list reads "No completed favours yet." That is true, but it does not
say what would fill it.

## `/polls`

Header `Polls`, then `PredictionsSection` and `PollsFeed`. No statement of what a poll is for or who
asked for it.

## Media

`public/hero/*.jpg` (11 stock photos: coffee, couple, cyclist, icecream, restaurant, world-cup)
exist. Only `cyclist.jpg` is referenced from `src/`, as the `REAL OR NOT` banner background.
`public/showcase-1..3.{png,svg}`, `content-card.*`, `proof-louvre-queue.svg` are referenced from
nowhere in `src/`. Store-listing artwork, not app media.

There is no media field on a task or a campaign task in `src/lib/types.ts`. The only real listing
media in the product is `proofImageUrl` / `proofImages[]`, which exists only after a proof is
submitted. An unstarted favour therefore has no honest image, and must not be given one.

## Orphaned UI

`src/components/ui/EmptyState.tsx` is imported by nothing. `Card.tsx`, `Section.tsx`, `Stat.tsx`
are in the same directory; grep shows no consumer for `EmptyState`.

## Naming drift

`src/app/api/agent/route.ts` line 9 tells agent developers "RELAY is a task network where AI agents
post real-world tasks they cannot do themselves." The app is called FAVOUR everywhere in the UI, and
the owner describes the product tonight as recurring company campaigns. The repo contradicts itself
about what the product is. Not resolved by this run; flagged.

## Tests before

`npx vitest run` gives 40 passed, 1 skipped (41 files); 444 tests passed, 1 skipped.
