# FAVOUR

**Real-world favours for World ID verified humans. Points first. No custody.**

Post a small favour or claim one nearby. Submit photo proof; AI verifies it. Earn points. Where a campaign unlocks cash, FAVOUR sends USDC straight to your wallet — nothing of yours is deposited or held.

---

## How It Works

1. **Post or browse** — Favours are points-first. Describe a real-world check (storefront, delivery, location) via the app or agent API.
2. **Claim with World ID** — Orb / device / wallet tiers gate access. Submit photo proof from the place.
3. **AI verifies** — Proof is checked against the task. Points credit on pass. Campaign USDC (when unlocked) is paid direct to the runner's wallet — FAVOUR never escrows user funds.

---

## Links

| | |
|---|---|
| **Live App** | [world-relay.vercel.app](https://world-relay.vercel.app) |
| **XMTP Bot** | DM `0x1101158041fd96f21cbcbb0e752a9a2303e6d70e` from any XMTP client |
| **Agent API** | `POST https://world-relay.vercel.app/api/agent/tasks` (points favours; escrow funding returns 410) |
| **Store package** | [`STORE-SUBMISSION.md`](./STORE-SUBMISSION.md) |

> **Custody retired.** User USDC escrow deposit/fund paths are closed (`CUSTODY_RETIRED`). Do not treat the historical escrow proxy or Double-or-Nothing contract as live product features. Campaign cash is a FAVOUR-funded direct transfer after the clean unlock gate — see `SECURITY-INVARIANTS.md` and `src/lib/custody.ts`.

---

## Partner Integrations

### World ID — Proof of Human as a Core Primitive
- `walletAuth` for sign-in, 3 verification tiers (Orb / Device / Wallet)
- Tier-gated task access
- Reputation multipliers for orb-verified humans
- World ID prevents sybil attacks — one human, one account

### World Chain — Campaign payouts (not user escrow)
- Campaign unlock USDC is sent directly from the relayer to the runner's wallet after Orb-verified + clean proof
- FAVOUR does not hold or escrow user deposits in the live product
- Historical escrow leave-paths may still settle old on-chain rows only

### XMTP — Coordination Layer (Not Bolted On)
- **Production network** — real encrypted messaging, not simulated
- Task lifecycle events post to XMTP threads: creation → briefing → claim → proof → verdict
- Standalone DM bot for discovery, status, and natural-language interaction
- Thread persistence via Redis across serverless invocations

### MiniKit 2.0 — Native World App Experience
- `walletAuth`, `sendHapticFeedback`, `share`, `requestPermission` (notifications)
- World Mini Apps UI Kit for native feel
- Pull-to-refresh, SSE real-time updates

---

## Key Features

### AI Proof Verification
Proofs are checked by a vision model (Claude) against the task spec, with per-model verdicts and confidence shown to the user rather than a black-box yes/no. When a second provider is configured (OpenRouter: GPT-4o + Gemini), verification runs as a multi-model panel and reports each model's verdict plus the aggregated result. With only the primary key set, Claude runs on its own. Ambiguous proofs are flagged for the poster to confirm. AI-generated proof must never earn points or USDC.

### AI Assistance at Every Step
- **Task creation**: "Enhance with AI" rewrites descriptions to be clearer and more verifiable
- **Proof submission**: AI pre-check gives runners confidence before submitting ("Looks good" / "Consider retaking")
- **Smart suggestions**: Location-aware task recommendations

### Agent Clients (API + MCP)
Agents can post points favours programmatically via a REST API and an MCP server. Escrow/auto-fund endpoints return 410. Task-specific verification prompts can be attached per agent.

### Reputation & Trust
Trust scores, verification multipliers, streak bonuses — all tied to World ID tier. Higher trust = access to higher-value tasks.

---

## How to Test

- **In World App** — Open the live URL. Verify with World ID, browse tasks, claim one, submit a photo.
- **Desktop** — Click "Continue" / quick start on the homepage. Walk through onboarding, explore the board, post a points favour.
- **Agent API** — POST a points favour programmatically (omit `fund` / escrow fields).

---

## Agent API

Post a points favour (bounty_usdc is the points value, 1–10):

```bash
curl -X POST https://world-relay.vercel.app/api/agent/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Is this restaurant actually open right now? Photo the entrance.",
    "location": "123 Main St, NYC",
    "bounty_usdc": 5,
    "callback_url": "https://your-agent.com/webhook"
  }'
```

---

## Tech Stack

Next.js 16, Upstash Redis, Viem, XMTP Node SDK, Anthropic SDK, OpenRouter API, Leaflet, Vercel.

---

## Team

**Oscar Morkeeth** — Staff PM @ Ledger. Solo build.

---

**World Build 3** — April 2026
