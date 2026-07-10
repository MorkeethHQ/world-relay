# Night run report — football leagues + points decision doc

Autonomous cloud run, zero local context (no Obsidian vault, no `.env.local`,
no redis/Upstash creds). Branch: `feat/football-leagues`.

## Bottom line

**The football.ts league change was NOT committed.** This environment's
network egress is fully locked down — I could not reach ESPN's API to
validate the new league slugs, and I could not reach `registry.npmjs.org` (or
even `pypi.org`) to install dependencies, so `tsc` and `vitest` could not be
run at all. The hard constraint for this run was "tsc + all tests green
before any commit," and I could not make that true, so per that constraint I
did not commit the code change. The proposed diff is included below,
unapplied, for Oscar to apply and verify locally.

What *did* ship on this branch: `docs/points-utility-options.md` (pure
documentation, no code risk) and this report.

## What I attempted

1. Created `feat/football-leagues` off `main` (confirmed in sync with
   `origin/main` at `d9e5535` before branching).
2. Edited `src/lib/football.ts` to extend `FOOTBALL_LEAGUES` from
   `["fifa.world"]` to `["fifa.world", "eng.1", "esp.1", "uefa.champions",
   "usa.1"]`. This is a pure data literal — no type changes, and no test file
   in the repo references `FOOTBALL_LEAGUES` or imports `football.ts` at all
   (confirmed via grep), so I'm confident it's mechanically safe. Confidence
   is not the same as verification, though, so it's not committed.
3. Tried to validate the four new ESPN slugs:
   `curl https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard`
   for `eng.1`, `esp.1`, `uefa.champions`, `usa.1` — **all blocked** by this
   environment's egress proxy: `CONNECT tunnel failed, response 403`. Also
   tried the WebFetch tool as a fallback path — also 403. **Zero leagues were
   validated live**, including no reconfirmation of the existing `fifa.world`.
4. Tried `npx tsc --noEmit` — failed immediately because `node_modules` does
   not exist in this fresh checkout (no postinstall / setup ran).
5. Tried `npm ci` to install dependencies — failed with `403 Forbidden` from
   `registry.npmjs.org`. Checked the proxy status endpoint
   (`$HTTPS_PROXY/__agentproxy/status`) and the raw response body, which
   confirmed this is a policy denial, not a transient error:
   `Host not in allowlist: registry.npmjs.org. Add this host to your network
   egress settings to allow access.` (header `x-deny-reason: host_not_allowed`).
   Confirmed the same denial for `pypi.org` — this environment's network
   policy has **no external egress at all** beyond whatever narrow allowlist
   it ships with (github, anthropic.com). Per the proxy README's own
   instruction ("do not retry organization policy denials — report them"), I
   did not attempt to route around this (no disabling TLS, no alternate
   registry, no retries beyond confirming it wasn't transient).
6. Given (3) and (5), `tsc`/`vitest` could not be run and ESPN slugs could
   not be validated. I reverted the working-tree edit to `football.ts` rather
   than commit unverified code.

## Proposed change (NOT applied — needs local verification)

```diff
--- a/src/lib/football.ts
+++ b/src/lib/football.ts
@@ -10,9 +10,8 @@
 
 const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
 
-// Leagues to pull. World Cup is live now; add domestic leagues here later
-// (eng.1 EPL, esp.1 La Liga, uefa.champions, usa.1 MLS, ...).
-export const FOOTBALL_LEAGUES = ["fifa.world"];
+// Leagues to pull. World Cup plus top domestic/continental competitions.
+export const FOOTBALL_LEAGUES = ["fifa.world", "eng.1", "esp.1", "uefa.champions", "usa.1"];
 
 export type Fixture = {
```

## What still needs Oscar (cloud could not do these)

a. Review this report + `docs/points-utility-options.md`, and decide whether
   to apply the diff above on a local machine (or a cloud environment with
   normal network egress) — run `npm ci && npx tsc --noEmit && npx vitest
   run`, validate the four ESPN slugs with a real `curl`, then open the
   actual PR. This run could not produce a mergeable PR because it could not
   verify anything.

b. Run `football-sync` locally against redis to confirm live create/resolve
   across the new leagues, and delete any test predictions it creates.

c. **#1 priority — verify the funding reward end to end.** Post a ~$0.50
   USDC task, complete it from a second identity, confirm escrow settles
   on-chain, and confirm the funder's points rise by exactly
   `fundingRewardPoints(bounty)`. This is the only real test of tonight's
   money-path change (`ebf83bb`) and cannot be done from the cloud (no redis
   creds, no ability to hold real funds here). This has not been touched or
   re-verified by this run.

d. Move `docs/points-utility-options.md` into the Obsidian vault, and add
   World's official numbers (479 users, 2197 sessions, 15111 impressions,
   as_of 2026-07-10) to the mindmap IDENTITY canonical numbers.

## Constraints honored

- Never merged to `main`.
- Never touched money/reward/verification code (`reward.ts`,
  escrow/verification paths untouched — confirmed via `git status`/`git
  diff`, only `docs/` and this report changed).
- Did not commit code without tsc/vitest green — since that couldn't be made
  true, the code change itself was left out rather than the constraint bent.
- Diff scope: this report + `docs/points-utility-options.md` only.
