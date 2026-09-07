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

## Build/test

- `npx tsc --noEmit`: clean, no errors (includes the uncommitted
  `board-rank.ts` WIP, see below).
- `npx vitest run`: could not run. This shell resolves `node --version` to
  **v16.15.0**. Vitest 4 / rolldown needs `node:util`'s `styleText`
  (Node 20.12+). `.vercel/project.json` pins production to `"nodeVersion":
  "24.x"`, confirmed from that file, not assumed. No `.nvmrc` in the repo.
  This is a shell/env mismatch, not a code regression. I could not identify
  or switch to a working node binary from inside this sandbox (probing
  `$HOME`, nvm, homebrew were all denied). **I did not run the test suite
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
   and test together"). Left as is on `main`, untouched, uncommitted. Do not
   assume it is finished or correct, I have no test signal on it either way.
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
