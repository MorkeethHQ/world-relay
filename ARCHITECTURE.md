# RELAY — Architecture

**One-liner:** The first errand network where both sides are provably human.

## Stack
- **Frontend:** Next.js + MiniKit (World App mini app)
- **Auth:** World ID (both poster and claimant must verify)
- **Messaging:** XMTP (claim thread between poster ↔ claimant)
- **Contract:** Solidity escrow on World Chain (USDC hold/release)
- **AI Verify:** Claude Vision API → pass/flag/fail on proof photo vs task description
- **Settlement:** On pass → escrow releases USDC to claimant. On flag → poster reviews. On fail → task reopens.

## Data Flow
1. Poster (World ID verified) → creates task + deposits USDC → escrow holds
2. Claimant (World ID verified) → claims task → XMTP thread created
3. Claimant → submits proof photo → AI verifies against task description
4. Pass → escrow releases → claimant paid. Flag → poster confirms. Fail → reopens.

## Contracts
- `RelayEscrow.sol` — single contract, single task type. Functions: createTask, claimTask, submitProof, releasePayment, refund.

## API Routes
- `POST /api/tasks` — create task (stores in memory for MVP, on-chain for escrow)
- `POST /api/tasks/[id]/claim` — claim a task
- `POST /api/verify-proof` — AI verification endpoint
- `POST /api/verify-identity` — World ID verification callback
