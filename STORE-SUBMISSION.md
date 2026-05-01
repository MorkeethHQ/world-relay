---
purpose: World mini app store submission copy
---

# App Store Submission

## App Name
RELAY FAVOURS

## Short Description (under 25 words)
AI agents deposit USDC for real-world tasks they can't do. Verified humans complete them, submit proof, get paid on-chain.

## Full Description
RELAY FAVOURS connects AI agents to verified humans for real-world tasks.

When an AI agent hits an execution dead-end — verifying a storefront, checking a delivery, confirming a location — it posts a favour with USDC locked in escrow. World ID verified humans nearby claim the task, submit photo proof, and get paid automatically after AI verification.

How it works:
1. An AI agent posts a favour and deposits USDC into an on-chain escrow contract
2. A World ID verified human claims it and receives an AI-generated briefing
3. The human submits photo proof from the real world
4. AI verifies the proof against the task requirements
5. USDC is released from escrow to the human's wallet

Built on World Chain with World ID (orb + device verification), XMTP encrypted messaging, and USDC escrow via a custom Solidity contract.

## Category
Earn

## Support Email
omorke@gmail.com

## App URL
https://world-relay.vercel.app

## Assets
- App Icon: public/app-icon.png (512x512)
- Content Card: public/content-card-new.png (345x240)

## Integration Details
- World ID: Orb + Device verification for claiming tasks (tier-gated bounties)
- MiniKit: Transaction signing for escrow deposits, claims, and releases
- World Chain: USDC escrow contract at 0xc976e463bD209E09cb15a168A275890b872AA1F0
- XMTP: Encrypted task threads and AI chat bot

---

## Changelog (since last review)

### v2.1 — 2026-05-01

**Transaction fixes (addresses "txn failing" feedback):**
- Fixed MiniKit v2 response handling — app now correctly reads `userOpHash` from successful transactions (previously looked for deprecated v1 `transactionHash` field, causing all txns to appear failed)
- Added visible error messages on all transaction flows (create, claim, fund, release, swap) — users now see a red banner with the specific error instead of silent failures
- Added success confirmation banners with tx hash + WorldScan link after every successful transaction
- Transactions that fail now trigger haptic error feedback + dismissible error UI

**UI improvements:**
- Task creation form shows inline error banner when transaction is rejected or network fails
- Fund button shows "Funding..." loading state during transaction
- Claim flow shows specific error messages (wrong access code, insufficient verification tier, wallet rejection)
- All transaction buttons have proper disabled states during processing

**Infrastructure:**
- Restored daily cron jobs (task expiry + demo seeding)
- Excluded standalone packages (MCP server, Python SDK) from Next.js type checking
- Build passes clean on Vercel (was failing 21h due to MCP server type import)

**Tested flows (World App, 2026-05-01):**
- Create task with USDC escrow deposit ✓
- Claim task with on-chain claimTask call ✓
- Submit proof with photo upload ✓
- Fund agent-posted task ✓
- Error feedback on rejected/failed transactions ✓
