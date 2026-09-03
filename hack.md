---
doc: hack
project: FAVOUR (RELAY FAVOURS) — agents pay verified humans for physical-world favours
phase: LAUNCH
event: none · World App mini-app store · first user, not a judge
canonical: true
last-touched: 2026-09-02 23:4x (Fable, probed; commits landed)
links: RELAY-SUMMARY.md · ARCHITECTURE.md · DESIGN-SYSTEM.md · BOARD-RULES.md
---

# FAVOUR — hack.md (the shared top file: vision, PRD, state, build plan)

## STATE 2026-09-02 (probed, not relayed)
- Repo `MorkeethHQ/world-relay`, branch `night/2026-09-02`, 356 commits, 0 dirty, 0 unpushed (`git status`, `git log @{u}..`).
- Live `https://world-relay.vercel.app` → 200. Contract `0x274C…9351` on World Chain (480), USDC.
- Cold stranger check PASSED 1 Sep (EOD receipt). `data/helicon.db` WAS tracked at HEAD until 2 Sep (blob `bae60d5` under `b1dc969`; the earlier `ls-files` probe read the index, where the deletion was already staged). Untracked for real in `3f434cb`; `.gitignore` covers `data/*.db`, `*.db`, `*.db-shm`, `*.db-wal`.
- The numbers in RELAY-SUMMARY.md ($48 deposited, $33 paid, 26 tx) were last committed **2026-07-01**. Two months stale; re-read on chain before any of them is said aloud.
- Ruling 8 (1 Sep, recommended): launch to USERS via the URL, not to judges.
- **23:4x (Fable lane):** the morning's 12 dirty files are committed on `night/2026-09-02` in named groups — gitignore `3f434cb` · api `3ab6314` · ui `b27800f` · test `b7fa59f` · docs `4485602` · transcript → `docs/STRANGER-RUN.md` `f8eea57` · fix `ed506dd` (loop_start was counted twice per favour on the claim → proof path). `npx vitest run`: 34 files / 377 tests passed, 1 skipped. Counter JSON pasted in `docs/STRANGER-RUN.md`. **0 pushed, 0 deployed** — the counter code is not live until Oscar pushes.

### Two doors (pick with one word)
- **HUMAN** — the door `LAUNCH-NOTE.md` sells: a person opens `https://world-relay.vercel.app` → Continue without wallet → Do it → photo/note proof → points. Measured by `GET /api/stats/loop` (arrive → intent → start → complete). Ready today; nothing to build before sending the URL.
- **AGENT** — the door the NORTH STAR sells: a bot posts a favour with a USDC deposit and a verified human closes it. What exists today: `POST /api/tasks` (poster auth, escrow-v2), the `mcp-server/` package (`relay-favours-mcp`, needs `RELAY_API_KEY`) and `sdks/python`. Bot-author path: `docs/AGENT-DOOR.md` (one curl, run locally 2026-09-03; the number is POINTS, the USDC rail is dark; keys are minted by the operator only). Until 2026-09-03 every `agent_` poster was hidden from the board (`isPublicTask`), so the door was dark at the board too — fixed on this branch, not deployed.
- Same app, same board, same counter; the doors differ in WHO arrives first and WHICH sentence is sent. The launch note is written for HUMAN.
- Say **human** → send the LAUNCH-NOTE sentence as is. Say **agent** → build plan item 3 comes first (≈3h) and the note is rewritten for a bot author.
- Cost of not picking: the counter stays at zero for both.

## NORTH STAR (vision, Oscar's words kept)
When AI hits a wall, RELAY finds a verified human. An agent deposits USDC, posts a favour, a World-ID-verified person closes the loop in the physical world, and the payment settles on completion.

## PRD — the five gate lines
- **Buyer + budget line:** an agent operator (a company running agents that touch the physical world: deliveries, listings, store checks) paying from ops spend per favour. Today the buyer is unproven; the honest line is "an agent developer paying from their own card".
- **Recurring number reported upward:** favours completed per week, and the share completed by a stranger.
- **Incumbent sprint test:** a task marketplace (TaskRabbit, Fiverr) can add an API in a sprint. The wedge they cannot take: World ID proof-of-person + on-chain settlement that an AGENT can call without an account. Build on that, not on the marketplace UI.
- **Day-two user (not Oscar):** an agent developer whose bot needs one thing checked in the real world. Installs because it is one HTTP call and one USDC deposit.
- **Vision paragraph (rejected once, rewritten):** ~~"A favour marketplace for agents"~~ → The settlement layer between software that cannot see and people who can: the check is declared before the favour, the money moves only when the check passes.

## BUILD PLAN 2026-09-02 (ordered; riskiest first)
1. **One stranger completes one favour** — done when the completion counter shows a run whose wallet is not Oscar's · 2h · risk: nobody arrives.
2. Empty state teaches: a new person sees one example favour and makes one in < 60s — done when the incognito transcript in `docs/STRANGER-RUN.md` shows it · 2h.
3. Agent-side call: `POST /favour` with deposit, documented in 10 lines for a bot author — done when a curl from a clean shell creates a favour · 3h.
4. Re-read on-chain totals and replace the July numbers everywhere — done when RELAY-SUMMARY matches the explorer · 1h.

## METRICS this project reports
Reach (favours completed by non-authors) · produced ÷ promised (favour posted → favour closed).

## STOP AT (Oscar only)
Sending the URL to a first user · any post · World App store submission.
