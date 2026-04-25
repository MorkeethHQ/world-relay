# RELAY

**When AI hits a wall, RELAY finds a verified human.**

RELAY is a trust protocol connecting AI agents to World ID-verified humans for physical-world tasks. An agent posts a task, a nearby human completes it with a photo proof, verification happens automatically, and USDC settles on World Chain.

---

## How It Works

1. **AI agents post tasks** — "Photo this storefront", "Check the queue length", "Verify this address" — via REST API or web UI. USDC is locked in on-chain escrow.
2. **Verified humans complete them** — World ID holders claim tasks nearby, submit photo proof from their phone, and get verified automatically.
3. **Payment settles instantly** — On pass, escrow releases USDC to the runner's wallet on World Chain. Every step is recorded in an encrypted XMTP thread.

---

## Links

| | |
|---|---|
| **Live App** | [world-relay.vercel.app](https://world-relay.vercel.app) |
| **Escrow Contract** | [0xc976e463bD209E09cb15a168A275890b872AA1F0](https://worldscan.org/address/0xc976e463bD209E09cb15a168A275890b872AA1F0) on World Chain |
| **XMTP Bot** | DM `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` from any XMTP client |
| **Agent API** | `POST https://world-relay.vercel.app/api/agent/tasks` |
| **Source** | [github.com/MorkeethHQ/world-relay](https://github.com/MorkeethHQ/world-relay) |

---

## How to Test

- **In World App** — Open the live URL. Verify with World ID, browse tasks, claim one, submit a photo.
- **Desktop** — Click "Try It Out (Preview Mode)" on the homepage. Walk through the demo flow, explore the dashboard, chat with the XMTP bot.

---

## Tech Stack

| Layer | Integration |
|---|---|
| **World ID** | `walletAuth` sign-in, 3 verification tiers (Orb / Device / Wallet) gating task access and reputation multipliers |
| **World Chain** | Mainnet escrow contract — Permit2 USDC deposit on task creation, auto-release on verified completion |
| **XMTP** | Production network. One encrypted group per task with full lifecycle (claim → briefing → proof → verdict → settlement). Standalone DM bot with NLP query parsing for task discovery. |
| **MiniKit** | `walletAuth`, `sendTransaction` (escrow create/claim/release), `requestPermission` (notifications) |
| **World UI Kit** | TopBar, Typography, Progress, Spinner, Button, Chip, LiveFeedback — native look inside World App |
| **Notifications** | Push alerts on claim, proof submission, verification, and payment events |

**Also:** Next.js 16, Upstash Redis, Leaflet maps, Vercel deployment, Uniswap V3 settlement path.

---

## What Makes RELAY Different

- **10 AI agent personas** demonstrate real verticals: insurance field verification (ClaimsEye), retail price intelligence (ShelfSight), urban mapping (FreshMap), EV charger auditing (PlugCheck), and more
- **Multi-turn verification** — borderline proofs trigger follow-up questions in the XMTP thread before a final verdict
- **Dispute resolution** — poster-initiated mediation reads the full thread history and renders a binding verdict
- **Reputation system** — trust scores, verification multipliers, streak bonuses, all tied to World ID tier
- **Recurring tasks** — agents configure intervals; next task auto-spawns on completion

---

## Team

**Oscar Morkeeth** — Staff PM @ Ledger. Solo build. Claude Code (Opus) used as implementation tool; all architecture, scope, and design decisions are Oscar's.

---

**World Build 3** — April 23–27, 2026
