# FAVOUR (formerly RELAY)

Live in the World App Store. Silver (2nd/500) at World Build. **Real money moves
through this now and people rely on it. Do not break it.**

## Context
- Next.js app, World ID integration, XMTP messaging, on-chain USDC escrow (World Chain 480)
- Rebrand in progress: RELAY → FAVOUR (copy/name only — see "Brand" below)

## Source of truth (avoid context drift)
When two docs disagree, the owner below wins. Do not treat a stale copy as truth.
- **What's next / priority:** the decision-log owns it (`project-relay-decision-log`
  memory + Obsidian `01 Projects/Relay/`). Roadmap docs are an idea *backlog*, not
  settled priority.
- **Live state** (counts, launch status): Obsidian dashboard.
- Never restate a fact that another doc owns — link to it. Copies drift; pointers don't.

## Production rules (enforce — no exceptions)
- **Money path is sacred.** Never mark a task paid unless settlement is confirmed
  on-chain. Every money-path change is verified end-to-end with a real request
  before commit — not just tsc.
- **No fake/simulated data, ever** — even for demos.
- **Points and USDC are never conflated.** `reward.ts` is the single source; points
  are `pts`, money is `$ USDC` and only real when escrow-funded on-chain.
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
  (`0x274C38…9351`, on-chain/immutable) and `NEXT_PUBLIC_WORLD_APP_ID` (registered
  with World). Renaming these breaks production and on-chain funds.
