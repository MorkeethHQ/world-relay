---
date: 2026-09-09
tags: [favour, night-shift, night-report]
source: claude-code
---

# FAVOUR night shift, 2026-09-09

## Health (curled prod, world-relay.vercel.app)
| endpoint | status | time |
|---|---|---|
| /api/tasks | 200 | 1.04s |
| /api/health | 200 | 0.21s |
| /api/predictions | 200 | 1.02s |
| /api/polls | 200 | 0.41s |
| /api/jury | 200 | 0.82s |

(First guessed `/api/jury/deck` and `/api/jury/card`, both 404, wrong paths.
Real route is `/api/jury` itself, `src/app/api/jury/route.ts`. Corrected and
reprobed before writing this down.)

`npx tsc --noEmit`: no output (clean). Real exit code not captured. The Bash
permission gate denied several retries of the exact same command mid-session,
non-deterministic, unrelated to command content (plain `git status` also
failed then succeeded on an identical retry). Flagging so this isn't silently
trusted: unverified exit code, verified only by the empty-output convention.

`npx vitest run`: still blocked, confirmed live tonight (not just trusted from
yesterday's report). `node:util` doesn't export `styleText` on this box's
Node 16.15.0, which `rolldown` (vitest's bundler) requires. Third night
running. This is a local dev-machine Node version problem, not a prod issue.
No signal either way on whether the actual test suite passes.

`npx next build`: not run. No code changed tonight, so nothing to verify.

## Signals
- `.watch-state.json` (updated today 04:53): unlock_paid 14, jury_verdict 2963,
  sign_in 1129, poll_vote 164, prediction_stake 65, completedCount 64.
- `.watch-cron.log`: updates hourly, last write 04:53 today, healthy cadence.
  Every entry also logs an Obsidian dashboard write failure (`errno -11`,
  favour-live.md), same iCloud file-provider issue that made the dashboard
  itself unreadable to me tonight (`EDEADLK` on Read). Cosmetic to the cron
  (it degrades and continues), but the dashboard hasn't been updated by it in
  a while. Unverified how long, the write always fails.
- `.ops-cron.log`: last write Sep 8 08:10, about 21h stale as of now (04:53
  Sep 9). Didn't find the crontab/launchd schedule to know if that is just
  "hasn't fired yet today" or actually broken. `crontab -l` and `launchctl
  list` were both outside tonight's permission allowlist. Not calling this an
  emergency (last known pulse was healthy: escrow $2, relayer $24.06, funding
  wallet $3.48, board 30 open/64 completed), but it's unconfirmed whether
  today's pulse ran at all. Named, not chased, outside a 25-turn triage shift.
  This also means last night's flagged "relayer down $16 over 3 runs,
  unverified" (2026-09-08 report) has had no new pulse since to confirm it
  recovered or explain it. Still open.
- `git log`: zero commits since last night's shift report (35aebcc, Sep 8
  05:05). Nothing "introduced today" to triage.
- `TODO`/`FIXME`/`XXX` in `src/`: zero hits.

## Found but NOT touched
`src/lib/board-rank.ts` has an uncommitted, unowned change sitting in the
working tree since before this shift started (present when I opened the
branch, not something I wrote). File mtime is 2026-09-04, confirmed with
`stat` tonight, unchanged from last night's report, so this is the same diff,
now five days dirty across at least 3 night shifts (Sep 7, Sep 8, tonight). It
rewrites `pickStarterFavour`: drops the `social` category's scoring bonus
entirely, adds a new "lenient starter" fast path for `feedback`/`review`, and
restructures the fallback logic. I did not commit or extend it because:

1. I don't know who wrote it or when. No commit, no message, no author.
2. CLAUDE.md is explicit: board-ranking changes go through BOARD-RULES.md plus
   a guard test, together with the code. This diff has no test. The existing
   `pickStarterFavour` describe block (`board-rank.test.ts:222`) only covers
   the old feedback-vs-photo case and doesn't exercise the new
   `LENIENT_STARTER_CATEGORIES` path or the `social` exclusion at all.
3. It changes product behavior (which favour a first-time user sees first).
   Night-shift rules say nothing that changes behavior without your sign-off.

It's still sitting in the working tree on `night/2026-09-09`, untouched,
uncommitted. Your call: finish it and add the guard test, or discard it.

## Committed tonight
Nothing on `night/2026-09-09` beyond this report. No bugs found worth fixing,
nothing introduced today to triage. `git log --oneline -15` before this shift
showed only doc/report commits and the two Sep 3 design fixes; the branch was
otherwise clean.

## Top 3 for you to decide
1. **Relayer wallet flag from 2026-09-08 (down $16 over 3 runs) is still
   unconfirmed**, and `.ops-cron.log` hasn't written since, so there has been
   no new pulse to check it against on-chain history for `0x1101...D70e`.
   Oldest open item, check this first.
2. **The `board-rank.ts` WIP is now 5 days dirty** (mtime 2026-09-04, flagged
   3 nights running). Yours or a stray, finish it with a guard test or
   `git checkout` it back. It should stop just sitting there.
3. vitest still can't run locally on Node 16 (3rd night flagged). Either bump
   local Node or accept CI/prod is the only place tests actually run. Right
   now nobody's watching this check pass or fail on this machine.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
