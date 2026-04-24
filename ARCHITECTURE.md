# RELAY — Architecture

**Trust protocol for physical-world task execution, powered by World ID.**

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│                                                                  │
│  Next.js 16 + MiniKit                                           │
│  ├── Landing (World ID auth via walletAuth)                     │
│  ├── Feed (GPS-sorted tasks, map view, categories)              │
│  ├── Task Detail (XMTP chat, proof display, escrow actions)     │
│  ├── Post Form (category picker, location, bounty)              │
│  ├── Proof Submission (camera → base64 → AI verify)             │
│  ├── Agent Showcase (/agents — interactive API demo)            │
│  └── MiniKit.sendTransaction for all on-chain operations        │
│       ├── Permit2 approve + escrow createTask                   │
│       ├── escrow claimTask                                      │
│       ├── escrow releasePayment                                 │
│       └── Uniswap V3 exactInputSingle (USDC → WETH/WLD)        │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────────────┐
│                        API LAYER (Next.js Routes)                │
│                                                                  │
│  /api/tasks ──────────── CRUD tasks (Redis-backed)              │
│  /api/tasks/[id]/claim ─ Claim + XMTP thread + push notify     │
│  /api/tasks/[id]/confirm Poster approve/reject flagged proof    │
│  /api/tasks/[id]/messages Chat within XMTP thread               │
│  /api/verify-proof ───── AI verify + on-chain attestation       │
│  /api/verify-identity ── World ID (IDKit v4 + walletAuth)       │
│  /api/agent/tasks ────── Agent API (external AI agents)         │
│  /api/rp-signature ───── RP signing for IDKit v4                │
│  /api/xmtp-status ────── XMTP client health                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────────────┐
│                      INTEGRATION LAYER                           │
│                                                                  │
│  World ID ───── IDKit v4 verify (developer.world.org/api/v4)   │
│  XMTP ───────── Node SDK, production network, encrypted groups  │
│  Claude ─────── Vision API (claude-sonnet-4-6) for proof verify │
│  Upstash ────── Redis for tasks, messages, verified users       │
│  World Notify ─ Push notifications on lifecycle events          │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────────────┐
│                      ON-CHAIN LAYER (World Chain 480)            │
│                                                                  │
│  RelayEscrow ─── 0xc976e463bD209E09cb15a168A275890b872AA1F0     │
│  USDC ────────── 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1     │
│  Permit2 ─────── 0x000000000022D473030F116dDEE9F6B43aC78BA3     │
│  SwapRouter02 ── 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45     │
│  WETH ────────── 0x4200000000000000000000000000000000000006     │
│  WLD ─────────── 0x2cFc85d8E48F8EAB294be644d9E25C3030863003     │
│                                                                  │
│  Attestation: AI verdict posted as calldata (self-send tx)      │
│  Format: { protocol: "relay-attestation-v1", taskId, verdict }  │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow: Complete Task Lifecycle

```
1. AUTH
   User opens World App → MiniKit.walletAuth → address + signature
   → POST /api/verify-identity → stored in Redis
   → MiniKit.requestPermission(notifications)

2. POST TASK
   User fills form (category, description, location, bounty)
   → MiniKit.sendTransaction:
     tx1: Permit2.approve(USDC, escrow, amount, expiry)
     tx2: RelayEscrow.createTask(description, bounty, deadline)
   → POST /api/tasks → stored in Redis with GPS coords

3. CLAIM TASK
   Runner sees task on feed or map → taps Claim
   → MiniKit.sendTransaction: RelayEscrow.claimTask(taskId)
   → POST /api/tasks/[id]/claim
     → XMTP group created for task
     → Structured claim notification sent to thread
     → Push notification to poster

4. SUBMIT PROOF
   Runner takes photo → base64 encoded → POST /api/verify-proof
   → submitProof(taskId, imageUrl, note) → saved in Redis
   → XMTP: "Proof submitted, AI verification in progress..."
   → Push notification to poster

5. AI VERIFICATION
   Claude Vision analyzes photo against task description
   → Category-adapted prompt (photo/delivery/check-in/custom)
   → Returns { verdict, reasoning, confidence }
   → completeTask updates status in Redis
   → XMTP: structured verdict message with confidence
   → Push notification to claimant (verified) or poster (flagged)

6. ON-CHAIN ATTESTATION
   If verdict is pass or flag:
   → Server signs tx with RP key
   → Self-send with calldata: { protocol, taskId, verdict, hashes }
   → Tx hash stored on task, linked in UI to WorldScan

7. SETTLEMENT
   Poster taps "Release $X USDC via World Chain"
   → MiniKit.sendTransaction: RelayEscrow.releasePayment(taskId)
   → XMTP: settlement confirmation with tx details

8. OPTIONAL SWAP
   Claimant selects preferred token (WETH/WLD)
   → MiniKit.sendTransaction:
     tx1: USDC.approve(SwapRouter02, amount)
     tx2: SwapRouter02.exactInputSingle(USDC → token, 0.3% pool)
```

## Key Files

```
src/
├── app/
│   ├── page.tsx                    # Landing + World ID auth
│   ├── agents/page.tsx             # Agent showcase + live API demo
│   └── api/
│       ├── tasks/route.ts          # Task CRUD
│       ├── tasks/[id]/claim/       # Claim + XMTP + notifications
│       ├── tasks/[id]/confirm/     # Poster approve/reject
│       ├── tasks/[id]/messages/    # XMTP chat
│       ├── agent/tasks/route.ts    # Agent API
│       ├── verify-proof/route.ts   # AI verify + attestation
│       ├── verify-identity/route.ts# World ID
│       └── rp-signature/route.ts   # IDKit v4 signing
├── components/
│   ├── Feed.tsx                    # Main UI: feed, map, earnings, gallery
│   └── TaskMap.tsx                 # Leaflet map with bounty pins
├── lib/
│   ├── store.ts                    # Redis-backed task store
│   ├── messages.ts                 # Redis-backed message store
│   ├── types.ts                    # Task, Category, Verification types
│   ├── redis.ts                    # Upstash Redis client
│   ├── xmtp.ts                    # XMTP client, groups, messaging
│   ├── contracts.ts               # Escrow + Uniswap ABI encoding
│   ├── verify-proof.ts            # Claude Vision verification
│   ├── attestation.ts             # On-chain attestation via calldata
│   ├── notifications.ts           # World push notifications
│   └── minikit-provider.tsx       # MiniKit wrapper
└── contracts/
    └── src/RelayEscrow.sol         # Escrow contract (deployed)
```

## Persistence Strategy

All state persisted in Upstash Redis with in-memory cache for hot reads. Graceful fallback to in-memory-only when Redis vars not set (local dev).

- Tasks: `task:{id}` + `task_ids` set
- Messages: `msgs:{taskId}` list
- Verified users: `verified:{address}`
- Rate limit: `ratelimit:verify` (20/hour counter with TTL)

## Security

- Anthropic API key server-side only (never in NEXT_PUBLIC_*)
- RP signing key server-side only
- Agent API supports optional Bearer token auth
- Rate limiting on AI verification (20/hour)
- Task participants validated on message send
- Poster identity checked on confirm actions
