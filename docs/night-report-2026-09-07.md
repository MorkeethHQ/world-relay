# Night report, 2026-09-07

Unattended shift. Session was sandboxed to `~/CODE/world-relay`, no bash or
file access outside the repo (vault, $HOME dotfiles all denied). Report lands
here instead of the vault. Paste or move it in if you want it there.

## Health (verified live, curl against https://world-relay.vercel.app)

| endpoint | status | latency |
|---|---|---|
| /api/tasks | 200 | 0.87s |
| /api/jury | 200 | 0.64s |
| /api/predictions | 200 | 0.79s |
| /api/polls | 200 | 0.40s |

No emergency. All four core endpoints up.

## Cron signals (read from scripts/.ops-cron.log, scripts/.watch-cron.log)

- `.ops-cron.log`: last successful run 2026-09-06 06:10 UTC (file mtime
  2026-09-06 08:10). Alerts: "no known issue" both that day and the day
  before. Money numbers flat and small: escrow contract $2.00, relayer
  $28.06, funding wallet $3.48, 0 open funded tasks, 0 settlements pending.
  No 2026-09-07 entry yet in the log as of this shift, consistent with the
  daily cron simply not having fired yet rather than a failure, but I have
  not confirmed which.
- `.watch-cron.log`: file mtime 2026-09-07 04:50, so this is today's data.
  Every hourly run ends in two caught, non-fatal errors: "ticker history
  read failed" and "ticker write failed", both `errno: -11` on the vault
  path `.../00 Dashboard/favour-live.md`. Same failure shape appears
  repeatedly through the log's history, not new tonight. It is swallowed
  ("continuing without it") so nothing downstream breaks, which is exactly
  the silent-failure shape: the live ticker dashboard in the vault has
  likely not been updating for a while and nothing surfaces that on its own
  screen. Not a money-path issue. Worth a look.

## Build/test

- `npx tsc --noEmit`: clean, no errors (includes the uncommitted
  `board-rank.ts` WIP, see below).
- `npx vitest run`: could not run. This shell resolves `node --version` to
  **v16.15.0**. Vitest 4 / rolldown needs `node:util`'s `styleText`
  (Node 20.12+). `.vercel/project.json` pins production to `"nodeVersion":
  "24.x"`, confirmed from that file, not assumed. No `.nvmrc` in the repo.
  This is a shell/env mismatch, not a code regression. I could not identify
  or switch to a working node binary from inside this sandbox: probing
  `$HOME`, nvm, and homebrew were all denied by the sandbox, so I never
  confirmed *why* it resolves to 16.15 (unverified). Best guess, also
  unverified: a non-interactive shell like this one may not source the
  rc file where a version manager sets the default, so it falls back to
  whatever `/usr/local/bin/node` is. If that guess is right, pinning
  `.nvmrc` alone will not fix an unattended run; the shell also needs to
  load whatever sets node's default. **I did not run the test suite
  tonight. Nothing below was verified by tests, only by tsc and live curl.**
- `npx next build`: not run, given the above and the turn/time budget.

## Found, not touched

1. **Uncommitted WIP already sitting in `src/lib/board-rank.ts`** before this
   shift started (not mine, not from tonight's commits). It rewrites
   `pickStarterFavour`: adds a `LENIENT_STARTER_CATEGORIES` pass (feedback,
   review) ahead of everything else, and removes the `social` scoring bonus
   entirely. Compiles clean under tsc. Could not run `board-rank.test.ts`
   against it (see vitest issue above), and board logic is explicitly gated
   in CLAUDE.md ("never tweak board logic inline, change the rules, code,
   and test together"). Untouched, still uncommitted in the working tree.
   It carries across branches, including this one, until someone commits,
   stashes, or discards it. Do not assume it is finished or correct, I have
   no test signal on it either way.
2. No TODO/FIXME markers in `src/`. No flaky-test or lint-bug leads to chase
   without a working test runner.
3. Last 3 commits (`aac00fd`, `11c5225`, `a433b67`), campaign copy/colour
   fixes and streak-freeze/ranks removal, read as deliberate, finished work,
   not something broken to patch.

## Nothing fixed on this branch

Given no working test runner, I chose not to write or land any code change
tonight. This repo's own rule is verify before commit with real exit codes,
and I could not produce one for vitest. A change that only passed tsc would
be unverified by the standard this repo holds itself to. `night/2026-09-07`
has only this report on it.

## Top 3 for morning

1. **Fix the local node version** (16.15 to 20+, ideally match prod's 24.x)
   before any agent, human or Claude, can trust a green tsc-only check here
   again. Cheapest fix: add `.nvmrc` pinning 24, or check why the default
   `nvm` alias resolves to 16.15 in a fresh shell.
2. **Rule on the `board-rank.ts` WIP diff.** Is it yours, half-done, or
   stale? It changes real board-visible behavior (removes `social`'s
   starter-favour bonus). Needs a verdict before it either lands or gets
   discarded.
3. Sandbox scope for unattended runs currently blocks reading and writing
   the Obsidian vault entirely. Worth deciding whether that is the permanent
   shape for night shifts (report lands in-repo instead) or a config gap.
