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
| **Escrow Contract** | [0xc976e463bD209E09cb15a168A275890b872AA1F0](https://worldscan.org/address/0xc976e463bD209E09cb15a168A275890b872AA1F0) on World Chain |
| **Double-or-Nothing Contract** | [0xadA2127035c6443420531f4F1Edbf73364B3d436](https://worldscan.org/address/0xadA2127035c6443420531f4F1Edbf73364B3d436) on World Chain |
| **XMTP Bot** | DM `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` from any XMTP client |
| **Agent API** | `POST https://world-relay.vercel.app/api/agent/tasks` |

---

## Partner Integrations

### World ID — Proof of Human as a Core Primitive
- `walletAuth` for sign-in, 3 verification tiers (Orb / Device / Wallet)
- Tier-gated task access: wallet users up to $10, device up to $50, orb unlimited
- Reputation multipliers: orb-verified humans get 1.5x trust score boost
- World ID prevents sybil attacks — one human, one account, real accountability

### World Chain — On-Chain Payment Infrastructure
- **RelayEscrow.sol** — mainnet contract holding real USDC. Funds locked on task creation, auto-released on AI verification pass
- **RelayDoubleOrNothing.sol** — high-stakes game mode. Runner matches the bounty. Verified = 2x payout. Failed = poster keeps both
- Permit2 approval pattern for gas-efficient token operations
- All transactions verifiable on [worldscan.org](https://worldscan.org)

### XMTP — Coordination Layer (Not Bolted On)
- **Production network** — real encrypted messaging, not simulated
- Every task lifecycle event posts to its XMTP thread: creation → briefing → claim → proof → verdict → payment
- Standalone DM bot for task discovery, status queries, and natural-language interaction
- Thread persistence via Redis across serverless invocations
- Remove XMTP and there is no RELAY — it's how humans and agents coordinate

### MiniKit 2.0 — Native World App Experience
- `walletAuth`, `sendTransaction` (escrow/DON create/claim/release), `sendHapticFeedback`, `share`, `requestPermission` (notifications)
- World Mini Apps UI Kit: Button, Chip, LiveFeedback for native feel
- Haptic feedback at 21 interaction points
- Pull-to-refresh, SSE real-time updates

---

## Key Features

### Multi-Model AI Consensus Verification
Three independent AI models (Claude, GPT-4o, Gemini) verify every proof in parallel. Individual verdicts displayed transparently — "Claude: Pass 92% | GPT-4o: Pass 88% | Gemini: Pass 91% — Consensus: Verified (3/3)". The AI isn't a black box — it's a panel of independent judges.

### Double-or-Nothing Game Mode
High-conviction task type where the runner stakes matching USDC. Verified = runner gets 2x. Failed = poster keeps both. Creates a trust signal — runners are betting on themselves. On-chain settlement via dedicated smart contract.

### AI Assistance at Every Step
- **Task creation**: "Enhance with AI" rewrites descriptions to be clearer and more verifiable
- **Proof submission**: AI pre-check gives runners confidence before submitting ("Looks good" / "Consider retaking")
- **Smart suggestions**: Location-aware task recommendations based on what agents need nearby

### 5 AI Agent Verticals
PriceHawk (price verification), FreshMap (urban mapping), QueueWatch (queue monitoring), AccessMap (accessibility auditing), ClaimsEye (listing verification) — each with custom personality and verification prompts.

### Reputation & Trust
Trust scores, verification multipliers, streak bonuses — all tied to World ID tier. Higher trust = access to higher-value tasks.

---

## How to Test

- **In World App** — Open the live URL. Verify with World ID, browse tasks, claim one, submit a photo.
- **Desktop** — Click "Quick Start" on the homepage. Walk through the interactive demo, explore the dashboard, chat with the XMTP bot.
- **Agent API** — POST a task programmatically and get the verified result via webhook callback.

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

---

## Tech Stack

Next.js 16, Upstash Redis, Solidity (Foundry), Viem, XMTP Node SDK, Anthropic SDK, OpenRouter API, Leaflet, Vercel.

---

## Team

**Oscar Morkeeth** — Staff PM @ Ledger. Solo build.

---

**World Build 3** — April 2026
