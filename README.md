# RELAY

**When AI hits a wall, RELAY finds a verified human.**

RELAY is a trust protocol for physical-world task execution. AI agents and humans post tasks that require a real person at a real location. World ID-verified humans claim, complete, and prove tasks — AI verifies the proof, USDC settles on-chain, and every step is recorded immutably.

38 million verified humans, each one a potential runner for any task an AI agent can describe.

**Live:** [world-relay.vercel.app](https://world-relay.vercel.app)
**Code:** [github.com/MorkeethHQ/world-relay](https://github.com/MorkeethHQ/world-relay)

---

## Judging Criteria Mapping

### Criteria 1: Use of World Stack

Every World primitive is load-bearing — remove any one and the product breaks.

| World Feature | How RELAY Uses It |
|---|---|
| **World Wallet** | MiniKit `walletAuth` for sign-in. `sendTransaction` for escrow creation (Permit2 + USDC deposit), task claiming, payment release, and Uniswap swaps. All on World Chain (480). |
| **Proof of Human** | World ID verification required for **both** poster and claimant. Without it, bots flood the claimant side, fake accounts farm bounties, and trust collapses. One human, one seat. |
| **World Chat (XMTP)** | Real XMTP groups created per task. Full lifecycle in the thread: claim notification, proof submission, AI verdict with confidence score, settlement confirmation. Users can chat within the thread. Encrypted end-to-end. The entire task story is readable from the XMTP conversation alone. |
| **Global User Base** | Agent API (`POST /api/agent/tasks`) turns 38M World ID users into the physical execution layer for any AI agent. Insurance AI posts a damage verification task → a nearby verified human claims it → proves with a photo → paid in USDC. |
| **Push Notifications** | World notification API wired for claim, proof, verification, and payment events. Users get pinged at every lifecycle moment. |
| **World Chain** | On-chain escrow contract, Uniswap V3 settlement, and proof attestation — all on World Chain mainnet. |

### Criteria 2: Idea Quality

RELAY is two products in one:

**Human → Human:** Post an errand. A verified person nearby does it. Proof verified by AI. Paid in seconds.

**Agent → Human:** Any AI agent posts a task via REST API. A verified human executes it in the physical world. The result flows back to the agent. Use cases:
- Insurance AI: "Photograph storm damage at this address"
- Real estate AI: "Take photos of building condition for buyer report"
- Supply chain AI: "Verify shelf stock at warehouse aisle 7"
- Market research AI: "Photograph competitor menu and pricing"

This isn't an errand app — it's infrastructure. Uniswap V3 settlement means poster can deposit any token, claimant receives preferred token. On-chain attestation creates an immutable record of every verified task. The trust layer is the product.

### Criteria 3: Build Quality

| Feature | Detail |
|---|---|
| **Task map** | Leaflet/OSM dark tiles with colored bounty pins, GPS distance, toggle between map and feed |
| **Task categories** | Photo, delivery, check-in, custom — each with an icon and category-adapted AI verification prompt |
| **Agent showcase** | `/agents` page with 4 interactive use cases and live "Post via API" button |
| **Earnings dashboard** | Total USDC earned, tasks completed, settlement stats on "Yours" tab |
| **Completion gallery** | Proof photos, AI verdicts, confidence scores, on-chain attestation links |
| **Chat** | Real-time XMTP messaging between poster and claimant within task detail |
| **Proof verification** | Camera capture → Claude Vision analysis → structured verdict with reasoning |
| **On-chain lifecycle** | Create (Permit2 approve + escrow deposit) → Claim → Release — all via MiniKit |

Everything is real — no stubs, no mocks, no "coming soon."

### Criteria 4: Team

**Oscar Morkeeth** — Staff Product Manager at Ledger. Architecture, product decisions, scope, and integration strategy are human-driven. Deep Web3 experience across hardware wallets, DeFi, and protocol design. Long-time FWB member — organized the Stockholm FWB x Matos event.

Claude Code was used as an implementation tool — the product vision, prioritization, and design decisions are Oscar's.

### Criteria 5: Wildcard

The agent-to-human bridge. No one else in this hackathon is connecting AI agents to physical-world human execution through World ID.

A single API call from any AI agent creates a task. A World ID-verified human — one of 38 million — claims it, walks to the location, proves completion with a photo, and gets paid in USDC. The AI gets the result it couldn't get any other way.

This is the missing piece between digital AI and the physical world.

---

## XMTP Integration Depth (World Chat Prize)

RELAY uses XMTP as the **primary coordination layer** for every task. This isn't notifications bolted onto a UI — the XMTP thread IS the task record.

**What happens in each XMTP thread:**

1. **Task Claimed** — Structured message with task description, location, bounty, claimant address
2. **Proof Submitted** — Notification with claimant's note, "AI verification in progress"
3. **AI Verdict** — Full structured result: VERIFIED/FLAGGED/REJECTED, reasoning, confidence score
4. **Settlement Confirmation** — USDC amount, World Chain transaction, "both parties verified human"
5. **User Chat** — Poster and claimant can exchange messages before, during, and after the task

**Technical implementation:**
- Production XMTP network (not dev/local)
- EOA wallet signer with `@xmtp/node-sdk`
- One encrypted group per task, created on claim
- Messages stored in Redis for offline access + delivered via XMTP protocol
- Singleton client pattern for serverless (survives cold starts with Redis)

A judge can read any XMTP thread and understand the complete story of a task without ever opening the app UI.

---

## Architecture

```
                          ┌─────────────────────────────────────┐
                          │           RELAY Protocol            │
                          └──────────────┬──────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
      ┌───────┴───────┐         ┌───────┴───────┐         ┌───────┴───────┐
      │  Human Poster  │         │   AI Agent    │         │  Human Runner  │
      │  (World ID)    │         │  (REST API)   │         │  (World ID)    │
      └───────┬───────┘         └───────┬───────┘         └───────┬───────┘
              │                          │                          │
              └──────────┬───────────────┘                          │
                         │ POST task + USDC deposit                 │
                         ▼                                          │
              ┌─────────────────────┐                               │
              │  RelayEscrow.sol    │                               │
              │  (World Chain 480)  │◄──────────────────────────────┘
              │  Permit2 + USDC     │        claim + prove
              └──────────┬──────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    ┌─────┴─────┐  ┌────┴────┐  ┌──────┴──────┐
    │  XMTP     │  │ Claude  │  │  Uniswap V3 │
    │  Thread   │  │ Vision  │  │  Settlement  │
    │  (E2E)    │  │ Verify  │  │  USDC→Token  │
    └───────────┘  └────┬────┘  └─────────────┘
                        │
              ┌─────────┼─────────┐
              │         │         │
            PASS      FLAG      FAIL
              │         │         │
          Release    Poster    Reopen
          USDC +     reviews   task
          attest     manually
          on-chain
```

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/tasks` | GET/POST | List and create tasks |
| `/api/tasks/[id]/claim` | POST | Claim a task (triggers XMTP thread + push notification) |
| `/api/tasks/[id]/confirm` | POST | Poster approves/rejects flagged proof |
| `/api/tasks/[id]/messages` | GET/POST | Read/send chat messages in task thread |
| `/api/verify-proof` | POST | Submit proof → AI verification → on-chain attestation |
| `/api/verify-identity` | GET/POST | World ID verification (IDKit v4 + walletAuth) |
| `/api/agent/tasks` | GET/POST | Agent API — AI agents post and list tasks |
| `/api/rp-signature` | POST | RP signing key for IDKit v4 |
| `/api/xmtp-status` | GET | XMTP client connection status |

## Smart Contracts

**RelayEscrow** — `0xc976e463bD209E09cb15a168A275890b872AA1F0` (World Chain mainnet)

Functions: `createTask`, `claimTask`, `releasePayment`, `failTask`, `refund`

USDC held in escrow on creation via Permit2. Released to claimant on verified completion. Refundable after deadline.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 + Turbopack |
| Mini App SDK | @worldcoin/minikit-js |
| Auth | World ID (IDKit v4 + RP signing) |
| Messaging | XMTP Node SDK (production network) |
| AI Verification | Claude Vision (claude-sonnet-4-6) |
| Escrow | Solidity + OpenZeppelin on World Chain |
| DEX | Uniswap V3 SwapRouter02 |
| Persistence | Upstash Redis |
| Map | Leaflet + OpenStreetMap (CartoDB dark) |
| Encoding | viem (ABI, Permit2, transactions) |
| Deployment | Vercel |

## Setup

```bash
git clone https://github.com/MorkeethHQ/world-relay.git
cd world-relay
npm install
cp .env.local.example .env.local  # add your keys
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_WORLD_APP_ID` | Yes | World App ID |
| `ANTHROPIC_API_KEY` | Yes | Claude Vision API key |
| `XMTP_WALLET_KEY` | Yes | Private key for RELAY bot XMTP identity |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Yes | Deployed RelayEscrow contract address |
| `RP_SIGNING_KEY` | Yes | World ID IDKit v4 RP signing key |
| `NEXT_PUBLIC_RP_ID` | Yes | World ID RP ID |
| `KV_REST_API_URL` | For persistence | Upstash Redis URL |
| `KV_REST_API_TOKEN` | For persistence | Upstash Redis token |
| `WORLD_NOTIFICATION_API_KEY` | For push notifications | World notification API key |
| `AGENT_API_KEY` | Optional | API key for agent endpoint auth |

## Built With (AI Tool Usage)

Per World Build 3 and ETHGlobal rules, we disclose AI usage:

- **Claude Code (Opus):** Used as the primary implementation tool for writing code, debugging, and iterating on features. All architecture decisions, product scope, integration strategy, and design choices were made by Oscar Morkeeth.
- **Claude Vision (Sonnet):** Used in production as the AI proof verification engine — analyzes submitted photos against task descriptions.

No AI-generated code was submitted without human review. The product vision, prioritization, and all judgment calls are human-driven.

---

**World Build 3** (FWB x World) — April 23-26, 2026

**Team:** Oscar Morkeeth — Staff PM @ Ledger, long-time FWB member (organized Stockholm FWB x Matos event)
