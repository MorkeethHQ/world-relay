# FAVOUR (formerly RELAY)

Live in the World App Store. Silver (2nd/500) at World Build. **Real money moves
through this now and people rely on it. Do not break it.**

## Context
- Next.js app, World ID integration, XMTP messaging. **Custody is retired**
  (`src/lib/custody.ts` — `CUSTODY_RETIRED = true`, decided 2026-07-28): no new
  funds can enter the first-party escrow. The escrow-v2 reopen attempt was rolled
  back after INCIDENT 2026-07-31 (see `d5d648c`). Real money still moves via a
  plain ERC-20 `transfer` from the relayer wallet for campaign unlocks — not
  custody, not a first-party contract.
- Rebrand in progress: RELAY → FAVOUR (copy/name only — see "Brand" below)

## Source of truth (avoid context drift)
When two docs disagree, the owner below wins. Do not treat a stale copy as truth.
- **What's next / priority:** the decision-log owns it (`project-relay-decision-log`
  memory + Obsidian `01 Projects/Relay/`). Roadmap docs are an idea *backlog*, not
  settled priority.
- **Live state** (counts, launch status): Obsidian dashboard.
- Never restate a fact that another doc owns — link to it. Copies drift; pointers don't.

## Board visibility/ranking changes — read first
What shows on the board and in what order is owned by `BOARD-RULES.md` +
`src/lib/board-rank.ts` + its guard test. Never tweak board logic inline in a
component; change the rules, code, and test together.

## Money/identity/reward changes — read first
Before touching any money, identity, reward, or verification code, read
`SECURITY-INVARIANTS.md` and follow its review method (audit by failure CLASS,
verify findings against real code + a live request, extend the guard test). ~20
broad reviews missed live money bugs because broad reads skim; the guard test
(`src/__tests__/invariants.guard.test.ts`) must stay green.

## Production rules (enforce — no exceptions)
- **Money path is sacred.** Never mark a task paid unless settlement is confirmed
  on-chain. Every money-path change is verified end-to-end with a real request
  before commit — not just tsc.
- **No fake/simulated data, ever** — even for demos.
- **Points and USDC are never conflated.** `reward.ts` is the single source; points
  are `pts`, money is `$ USDC` and only real when paid out via the relayer's
  ERC-20 transfer (`campaign-unlock.ts`) — custody/escrow-funding is retired,
  see `src/lib/custody.ts`.
- **AI-generated proof may appear as content but must NEVER earn** points or USDC,
  nor count toward completions / leaderboard / campaign unlock.
- **Campaign cash unlocks only through the clean gate:** Orb-verified + passed
  verification (no AI/stock/screenshot) + no flags.
- Resolve usernames, not raw wallet addresses, in all UI. Keep UI consistent.
- `tsc` clean before every commit. PR-sized commits on a branch. **Never push
  without Oscar.** Verify in the running app before reporting a change done.

## Brand
- Name is **FAVOUR** (dropping RELAY). Rename in copy/metadata/store listing only.
- **Frozen forever — never change these:** the escrow contract address
  (`0x274C38…9351`) and `NEXT_PUBLIC_WORLD_APP_ID` (registered with World).
  Renaming these breaks production and on-chain funds.

## The escrow is a PROXY, not an immutable contract (corrected Jul 17 2026)

This doc said "on-chain/immutable". That is false and it mattered, because it framed
the money contract as a thing nobody could change.

- `0x274C38…9351` is a **UUPS proxy** (328 bytes). Real logic lives at implementation
  `0x3E359dA2a355E14C8410480ffC7f0Fd569BbD221`. The ADDRESS is stable — that part of
  "frozen" is right and is exactly what a proxy buys. The CODE behind it is swappable.
- **The upgrade authority is `owner()` = `0x1101…D70e` — the RELAYER HOT WALLET.**
  That is `XMTP_WALLET_KEY`: it sits in `.env.local`, it is in Vercel env, and it
  auto-signs every payout and cron. Whoever holds that key can replace the escrow
  logic and take whatever it holds. Today that is $2, so the blast radius is small.
- **The source no longer exists.** `git log --all -S"fundTask" -- '*.sol'` = 0 commits;
  it is not on Oscar's machine; the contract is UNVERIFIED on the explorer (so is the
  implementation). The build artifact carries the ABI (70 entries) + bytecode but only
  keccak hashes of the sources, not their text. Backed up Jul 17 to
  `01 Projects/Relay/escrow-recovery/`, since it was one gitignored folder on one laptop.
  `contracts/src/RelayAgentEscrowV2.sol` is an EARLIER version — no `fundTask`.

**Sequencing rule this creates:** do NOT open user self-funding until the upgrade
authority is off the hot wallet. The whole point of that feature is to put other
people's money into this contract, and right now the key that pays out is also the key
that can rewrite it. Order: move ownership to a cold/multisig wallet → recover or
re-verify the source → then open funding.
