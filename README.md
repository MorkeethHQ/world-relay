# RELAY

> **TL;DR:** RELAY connects AI agents to World ID-verified humans for physical-world task execution. One API call creates a bounty, a verified human walks to the location and proves completion with a photo, Claude Vision verifies the proof, and USDC settles on World Chain. Seven World primitives — World ID, World Wallet, World Chat (XMTP), World Chain, Push Notifications, MiniKit, and World UI Kit — are all load-bearing. Remove any one and the protocol breaks.

**When AI hits a wall, RELAY finds a verified human.**

RELAY is a trust protocol for physical-world task execution. AI agents post tasks that require eyes, hands, or feet on the ground. World ID-verified humans claim, complete, and prove them. Claude Vision verifies the proof, USDC settles on-chain via Uniswap V3, and every step is recorded in an encrypted XMTP thread. 38 million verified humans become the physical execution layer for any AI agent with an API key.

---

## Try It

| | |
|---|---|
| **Live app** | [world-relay.vercel.app](https://world-relay.vercel.app) |
| **DM the XMTP bot** | Send a message to `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` in any XMTP client — the bot responds with available tasks and guides you through claiming |
| **Agent API** | `POST https://world-relay.vercel.app/api/agent/tasks` — any AI agent can post a task in one call |
| **Source** | [github.com/MorkeethHQ/world-relay](https://github.com/MorkeethHQ/world-relay) |

---

## 1. Use of World Stack (Criteria 1)

**Every World primitive is load-bearing. Remove any one and the protocol breaks.**

RELAY does not bolt World features onto an existing product. The World stack IS the product — identity, wallet, messaging, notifications, and chain are each wired into the core task lifecycle.

| World Primitive | How RELAY Uses It | What Breaks Without It |
|---|---|---|
| **World ID (Proof of Human)** | Verification required for both poster and claimant. Three trust tiers gate access: **Orb** (all tasks), **Device** (≤$20), **Wallet** (≤$10). Reputation system tracks completion rate, avg AI confidence, and trust score per verified human. | Bots flood the claimant side. No trust tiers. No reputation. The marketplace collapses. |
| **World Wallet (MiniKit)** | `walletAuth` for sign-in. `sendTransaction` for escrow creation (Permit2 + USDC deposit), task claiming, payment release, and Uniswap V3 swaps. All transactions on World Chain (480). | No on-chain escrow. No trustless payment. No token flexibility. |
| **World Chat (XMTP)** | One encrypted group per task. Full lifecycle in the thread: claim notification, AI briefing, proof submission, AI verdict with confidence score, multi-turn follow-up, dispute resolution, settlement confirmation. Claude AI is an active participant in every thread. DM bot responds to direct messages with task discovery and claiming guidance. | No coordination layer. No AI-in-the-loop conversation. No auditable task record. |
| **World Chain** | On-chain escrow contract (RelayEscrow.sol), Uniswap V3 settlement (poster deposits any token, claimant receives preferred token), proof attestation — all on World Chain mainnet. | No escrow. No settlement. No immutable record. |
| **Push Notifications** | World notification API fires on claim, proof submission, verification verdict, payment release, and dispute events. Users get pinged at every lifecycle moment. | Users miss time-sensitive tasks. Completion rate drops. |
| **MiniKit UI Components** | World UI Kit integrated throughout: TopBar, Typography, Progress, Spinner, Button, Chip, LiveFeedback. The app looks and feels native to World App. | App looks foreign inside World App. Breaks user trust. |
| **Global User Base** | Agent API (`POST /api/agent/tasks`) turns 38M World ID users into the physical execution layer for any AI agent. One API call from an insurance AI → a nearby verified human photographs storm damage → paid in USDC. | No supply side. Agents have no one to execute tasks. |

**Integration depth:** 7 World primitives, each one structural. The escrow contract lives on World Chain. The messaging layer is XMTP. The identity layer is World ID. The wallet is MiniKit. The UI is World UI Kit. The notifications are World API. The user base is World App's 38M verified humans.

---

## 2. Idea Quality (Criteria 2)

**AI can do everything except be somewhere. RELAY fixes that.**

Every major AI system will eventually hit the same wall: it needs ground truth from the physical world. A photo of a storefront. Confirmation that a package arrived. Proof that a charging station works. Today, AI has no reliable way to get this. RELAY creates the bridge.

**Two products in one protocol:**

**Agent-to-Human** — Any AI agent posts a task via REST API. A World ID-verified human executes it physically. The result flows back to the agent. 10 branded agent personas demonstrate real verticals:

| Agent | Use Case | Market Signal |
|---|---|---|
| **ClaimsEye** | "Photograph storm damage at this address" | Insurance field verification — $2.1T global premiums |
| **ShelfSight** | "Photo the cereal aisle, capture all prices" | CPG retail intelligence — $2.8B market |
| **FreshMap** | "Photo every storefront on this block" | Google Street View is 1-3 years stale |
| **PlugCheck** | "Photo this EV charger's status" | Networks claim 99% uptime; reality is 71% |
| **QueueWatch** | "Is there a line? How many people?" | Real-time occupancy data |
| **AccessMap**, **BikeNet**, **PriceHawk**, **GreenAudit**, **ListingTruth** | Accessibility auditing, bike infrastructure, price comparison, sustainability, listing verification | Each a $100M+ data market |

**Human-to-Human** — Post an everyday errand. A verified person nearby does it. Pay $2-5 for things you cannot do remotely: "Is there a line?", "What are today's specials?", "Verify this Airbnb exterior", "Is the parking lot full?"

**Why this is infrastructure, not an errand app:** Uniswap V3 settlement means the poster can deposit any token and the claimant receives their preferred token. On-chain attestation creates an immutable record of every verified task. The trust layer — World ID tiers + AI verification + reputation — is the product.

---

## 3. Build Quality (Criteria 3)

**26 seed tasks across 4 cities. Pre-populated completed task showing the full lifecycle. Every feature works end-to-end.**

The app is live at [world-relay.vercel.app](https://world-relay.vercel.app). There are no stubs, no mocks, no "coming soon" labels.

**Core systems:**

| System | Implementation |
|---|---|
| **Trust tiers** | Orb/Device/Wallet verification levels gate task access. $20+ requires Orb. Server-enforced. |
| **Reputation engine** | Per-user: completion count, success rate, avg AI confidence, trust score. Redis-backed. Runner streaks tracked — consecutive completions earn up to +15% trust bonus. |
| **AI proof verification** | Camera capture → Claude Vision (Sonnet) analyzes photo against task description → structured verdict with confidence score + location check |
| **Multi-turn verification** | Medium-confidence proofs (60-85%) trigger AI follow-up questions in the XMTP thread. Claimant responds. Claude re-evaluates with conversation context. |
| **AI dispute resolution** | Poster triggers AI mediation on flagged proofs. Claude reads the full XMTP thread history, the proof photo, and the initial verdict — renders a binding verdict. |
| **Location proof** | Runner GPS checked against task coordinates at proof submission. Distance shown in verdict. |
| **On-chain lifecycle** | Create (Permit2 approve + escrow deposit) → Claim → Release — all via MiniKit `sendTransaction` |
| **Recurring tasks** | Agents configure interval + total runs. Auto-spawns next task on completion. Daily price checks, bi-daily queue monitoring. |
| **XMTP DM bot** | Direct message `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` — bot responds intelligently with available tasks, task details, and claiming guidance |

**Pages and UI:**

| Page | What's There |
|---|---|
| **Landing** | Hero with three pillars, agent showcase scroll, network stats |
| **Task feed + map** | Leaflet/OSM dark tiles with colored bounty pins, GPS distance, toggle between map and list. 26 seed tasks across Paris, NYC, Seoul, and hackathon vibes. |
| **Task detail** | Visual 5-step timeline (Posted → Claimed → Proof → Verified → Settled), chat thread, proof submission |
| **Pre-populated completed task** | Full lifecycle visible: claim → proof photo → AI verdict → settlement confirmation |
| **Dashboard** (`/dashboard`) | Network overview (agents, tasks, verified, recurring) + per-agent cards with stats grid, confidence bars, color-coded badges. Built with World UI Kit. |
| **Gallery** (`/gallery`) | Public feed of all verified proofs with images, AI verdicts, confidence scores, on-chain links. Filter by photo/check-in. |
| **Live** (`/live`) | Real-time activity feed — claims, verifications, agent posts. Polished with World UI Kit components. |
| **Leaderboard** (`/leaderboard`) | Top runners ranked by trust score, confidence bars, earnings. Lightning badge at 3+ streak. |
| **Agent showcase** (`/agents`) | Enterprise + everyday use cases, live "Post via API" button |
| **Earnings + profile** | Identity card with verification badge, USDC earned, trust tier explanation |

**UI polish:** World UI Kit components throughout — TopBar, Typography, Progress, Spinner, Button, Chip, LiveFeedback. Task urgency system: <4h deadline OR ≥$15 bounty sort to top with gradient border + URGENT badge. Activity ticker, network stats bar, 10 one-tap task templates.

---

## 4. Team (Criteria 4)

**Solo build. Staff PM at Ledger. Deep Web3 experience. FWB member who organized the Stockholm FWB x Matos event.**

**Oscar Morkeeth** — Staff Product Manager at Ledger, working across hardware wallets, DeFi, and protocol design. Every architecture decision, product scope, integration strategy, and design choice is human-driven.

Claude Code (Opus) was used as an implementation tool — translating product decisions into code. The vision, prioritization, and all judgment calls are Oscar's.

---

## 5. Wildcard (Criteria 5)

**The agent-to-human bridge. Nobody else is building this.**

A single API call from any AI agent creates a task. A World ID-verified human — one of 38 million — claims it, walks to the location, proves completion with a photo, and gets paid in USDC. The AI gets a result it could not get any other way.

This is the missing piece between digital AI and the physical world. Every AI lab, every agent framework, every autonomous system will eventually need verified ground truth from a specific place at a specific time. RELAY is how they get it.

The combination is unique: World ID for sybil resistance, XMTP for encrypted multi-turn AI coordination, Claude Vision for automated verification, Uniswap V3 for flexible settlement, and a smart contract escrow that makes the whole thing trustless. Each layer reinforces the others.

38 million humans. One API call. Physical-world execution on demand.

---

## XMTP World Chat Prize ($5K)

**RELAY uses XMTP as the primary coordination layer — not as a notification pipe. Claude AI is an active participant in every thread.**

The XMTP integration goes deeper than messaging. Every task creates an encrypted group where the full lifecycle plays out. A judge can open any XMTP thread and follow the complete story without ever touching the web UI.

**What happens in each XMTP thread:**

1. **Task Claimed** — Structured message: task description, location, bounty, claimant address
2. **AI Briefing** — Claude Haiku generates task-specific tips ("capture price labels clearly", "include store signage in frame")
3. **Proof Submitted** — Claimant's note + "AI verification in progress"
4. **AI Verdict** — Structured result: VERIFIED / FLAGGED / REJECTED, reasoning, confidence score
5. **AI Follow-Up** (if confidence 60-85%) — Claude asks a targeted follow-up question. Claimant replies. Claude re-evaluates with full context.
6. **AI Dispute Resolution** (if flagged) — Poster triggers mediation. Claude reads the full thread, analyzes all evidence, renders a binding verdict.
7. **Settlement Confirmation** — USDC amount, World Chain transaction, "both parties verified human"
8. **User Chat** — Poster and claimant exchange messages throughout

**XMTP DM Bot:**

DM `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` from any XMTP client. The bot responds intelligently — listing available tasks, providing task details, and guiding users through claiming. This is a standalone XMTP integration, not a web-app redirect.

**AI as thread participant:**

| Feature | What Happens | Model |
|---|---|---|
| **Claim Briefing** | Claude generates task-specific photography tips posted to the XMTP thread | Haiku |
| **Multi-turn Verification** | Medium confidence (60-85%) → Claude asks a follow-up in-thread → claimant responds → Claude re-evaluates | Haiku (vision) |
| **Dispute Resolution** | Poster triggers mediation → Claude reads full thread history + proof photo + initial verdict → binding verdict | Haiku (vision) |

**Technical depth:**
- Production XMTP network (not dev/local)
- EOA wallet signer with `@xmtp/node-sdk`
- One encrypted group per task, created on claim
- Singleton client pattern for serverless (survives cold starts via Redis)
- Messages stored in Redis for offline access + delivered via XMTP protocol
- Claude Haiku for conversational messages (briefings, follow-ups, disputes) — cost-efficient
- Claude Sonnet for primary proof verification (vision) — high accuracy

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
| `/api/tasks/[id]/claim` | POST | Claim task — enforces World ID trust tier + triggers AI briefing in XMTP |
| `/api/tasks/[id]/confirm` | POST | Poster approves/rejects flagged proof |
| `/api/tasks/[id]/followup` | POST | Re-evaluate proof after claimant responds to AI follow-up |
| `/api/tasks/[id]/dispute` | POST | AI dispute resolution — Claude reads full thread, renders binding verdict |
| `/api/tasks/[id]/messages` | GET/POST | Read/send chat messages in task thread |
| `/api/verify-proof` | POST | Submit proof → AI verification → location check → reputation update → attestation |
| `/api/verify-identity` | GET/POST | World ID verification (IDKit v4 + walletAuth) |
| `/api/agent/tasks` | GET/POST | Agent API — AI agents post and list tasks (10 branded personas), recurring config |
| `/api/reputation` | GET | User reputation (trust score, completion rate) or leaderboard |
| `/api/seed` | POST | Seed 26 demo tasks from AI agent personas across 4 cities |
| `/api/rp-signature` | POST | RP signing key for IDKit v4 |
| `/api/xmtp-status` | GET | XMTP client connection status |
| `/api/xmtp-agent` | POST | XMTP DM bot — handles direct messages with task discovery and guidance |

## Smart Contracts

**RelayEscrow** — `0xc976e463bD209E09cb15a168A275890b872AA1F0` (World Chain mainnet)

Functions: `createTask`, `claimTask`, `releasePayment`, `failTask`, `refund`

USDC held in escrow on creation via Permit2. Released to claimant on verified completion. Refundable after deadline.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 + Turbopack |
| Mini App SDK | @worldcoin/minikit-js |
| UI Components | World UI Kit (TopBar, Typography, Progress, Spinner, Button, Chip, LiveFeedback) |
| Auth | World ID (IDKit v4 + RP signing) |
| Messaging | XMTP Node SDK (production network) |
| AI Verification | Claude Sonnet (vision) — proof verification |
| AI Conversation | Claude Haiku — XMTP briefings, follow-ups, dispute resolution |
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
| `WORLD_NOTIFICATION_API_KEY` | For push | World notification API key |
| `AGENT_API_KEY` | Optional | API key for agent endpoint auth |

## Built With (AI Tool Usage)

Per hackathon rules: **Claude Code (Opus)** was the implementation tool — all architecture, product scope, and design decisions are Oscar Morkeeth's. **Claude Vision (Sonnet)** runs in production as the AI proof verification engine. No AI-generated code was submitted without human review.

---

**World Build 3** (FWB x World) — April 23-27, 2026

**Team:** Oscar Morkeeth — Staff PM @ Ledger | FWB member (organized Stockholm FWB x Matos)
