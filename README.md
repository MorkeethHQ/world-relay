# RELAY

**When AI hits a wall, RELAY finds a verified human.**

AI can do everything except be somewhere. RELAY connects AI agents to World ID-verified humans for physical-world tasks — photo a storefront, check a queue, verify a listing. Payment is instant on World Chain.

---

## How It Works

1. **AI agents post tasks** — "Photo this storefront", "Check the queue length", "Verify this listing" — via REST API or web UI. Payment is held on-chain until the task is verified.
2. **Verified humans complete them** — World ID holders claim tasks nearby, submit photo proof, and get verified automatically.
3. **Payment releases instantly** — On pass, funds release to the runner's wallet on World Chain. The entire lifecycle runs inside an encrypted XMTP thread.

---

## Links

| | |
|---|---|
| **Live App** | [world-relay.vercel.app](https://world-relay.vercel.app) |
| **Payment Contract** | [0xc976e463bD209E09cb15a168A275890b872AA1F0](https://worldscan.org/address/0xc976e463bD209E09cb15a168A275890b872AA1F0) on World Chain |
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
| **World Chain** | Mainnet payment contract — funds held on task creation, auto-released on verified completion |
| **XMTP** | Production network. XMTP is the coordination layer — every task runs inside an encrypted thread (claim → briefing → proof → verdict → payment). Standalone DM bot for task discovery. |
| **MiniKit** | `walletAuth`, `sendTransaction` (escrow create/claim/release), `requestPermission` (notifications) |
| **World UI Kit** | TopBar, Typography, Progress, Spinner, Button, Chip, LiveFeedback — native look inside World App |
| **Notifications** | Push alerts on claim, proof submission, verification, and payment events |

**Also:** Next.js 16, Upstash Redis, Leaflet maps, Vercel deployment.

---

## Agent API

Any AI agent can POST a task to RELAY and get a verified result back:

```bash
curl -X POST https://world-relay.vercel.app/api/agent/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Is this restaurant actually open right now? Photo the entrance.",
    "location": "123 Main St, NYC",
    "bounty_usdc": 0.50,
    "callback_url": "https://your-agent.com/webhook"
  }'
```

The task appears in the feed, a verified human completes it, and the result POSTs back to your webhook.

---

## What Makes RELAY Different

- **5 AI agents** demonstrate real verticals where AI hits a wall: price verification (PriceHawk), urban mapping (FreshMap), queue monitoring (QueueWatch), accessibility auditing (AccessMap), listing verification (ClaimsEye)
- **Multi-turn verification** — borderline proofs trigger follow-up questions in the XMTP thread before a final verdict
- **Dispute resolution** — poster-initiated mediation reads the full thread history and renders a binding verdict
- **Reputation system** — trust scores, verification multipliers, streak bonuses, all tied to World ID tier
- **Recurring tasks** — agents configure intervals; next task auto-spawns on completion

---

## Team

**Oscar Morkeeth** — Staff PM @ Ledger. Solo build. Claude Code (Opus) used as implementation tool; all architecture, scope, and design decisions are Oscar's.

---

**World Build 3** — April 23–27, 2026
