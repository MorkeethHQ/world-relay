# RELAY

**The first errand network where both sides are provably human.**

Someone posts a task that requires a real human in a specific place. Someone nearby claims it. They do it. They submit proof. AI verifies the proof matches the task. Payment releases instantly. Both sides are World ID-verified. One human, one seat.

## How it works

1. **Post** — describe the errand, set a USDC bounty, pick a location
2. **Claim** — a verified human nearby sees the task and claims it
3. **Do** — they complete the errand and snap a proof photo
4. **Verify** — AI vision checks if the proof matches the task description (pass / flag / fail)
5. **Pay** — on pass, escrow releases USDC to the claimant instantly

## Why World ID is load-bearing

Remove World ID and the product breaks. Bots flood the claimant side, fake accounts farm bounties, and posters can't trust that a real human walked to a real place. World ID makes both sides provably unique humans — that's the primitive that makes the network real.

## Demo

Post a bounty: "Take a photo of the line at the coffee shop on 5th and Main." Someone nearby claims it. Walks outside. Snaps the photo. Submits. AI verifies. Paid in 30 seconds.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js + MiniKit (World App mini app) |
| Auth | World ID — both poster and claimant verified |
| Messaging | XMTP — conversation thread between poster and claimant |
| AI Verification | Claude Vision API — pass/flag/fail with reasoning |
| Escrow | Solidity contract on World Chain (USDC hold/release) |
| Settlement | On pass: escrow releases. On flag: poster reviews. On fail: task reopens. |

## Architecture

```
Poster (World ID) ──> Create Task + Deposit USDC ──> Escrow holds
                                                          │
Claimant (World ID) ──> Claim Task ──> XMTP thread created
                                                          │
Claimant ──> Submit Proof Photo ──> AI Verification
                                          │
                              ┌───────────┼───────────┐
                            PASS        FLAG        FAIL
                              │           │           │
                        Escrow releases  Poster     Task
                        USDC to         reviews    reopens
                        claimant        manually
```

## Setup

```bash
git clone https://github.com/MorkeethHQ/world-relay.git
cd world-relay
npm install
cp .env.local.example .env.local  # add your keys
npm run dev
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_WORLD_APP_ID` | Yes | World App ID from developer.worldcoin.org |
| `ANTHROPIC_API_KEY` | For real verification | Claude Vision API key (falls back to stub without it) |
| `XMTP_WALLET_KEY` | For messaging | Private key for the RELAY bot identity |

## Smart contract

`contracts/RelayEscrow.sol` — a single escrow contract on World Chain.

Functions: `createTask`, `claimTask`, `releasePayment`, `failTask`, `refund`

USDC is held in escrow on task creation and released to the claimant on verified completion. Unclaimed tasks refund to the poster after the deadline.

## Integration targets

- **World ID** — sybil-resistant verification, one human one seat
- **XMTP** — conversation layer between poster and claimant (Shane Mac is a judge)
- **World Chain** — USDC escrow, gasless via World App sponsorship
- **Uniswap** — optional token swap on settlement (Angela Ocando is a judge)

## What we cut for clean ship

- No dispute resolution beyond poster-confirms
- No GPS-fenced claiming (city-level is enough)
- No chat app (proof is the communication)
- No multi-task bundles
- No web app (World App mini app only)

## Built for

World Build 3 (FWB x World) — April 23-26, 2026

## Team

Oscar Morkeeth — scope, build, taste
