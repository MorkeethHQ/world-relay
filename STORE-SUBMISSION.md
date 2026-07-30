---
purpose: World mini app store submission copy
---

# App Store Submission

## App Name
FAVOUR

## Short Description (under 25 words)
Post and complete real-world favours for points. World ID verified. AI checks proof. Campaign USDC paid to your wallet — no custody.

## Full Description
FAVOUR is a points-first favours marketplace for World ID verified humans.

Post a small real-world favour — check a storefront, confirm a delivery, snap a location — or claim one nearby. Submit photo proof; AI verifies it against the task. Earn points for completed favours. Where a campaign unlocks cash, FAVOUR sends USDC straight to your wallet after Orb verification and a clean proof — nothing of yours is ever deposited or held.

How it works:
1. Post a favour for points, or browse open favours nearby
2. Claim with World ID (orb / device / wallet tiers)
3. Submit photo proof from the real world
4. AI verifies the proof against the task requirements
5. Earn points — and campaign USDC when you unlock, paid direct to your wallet

FAVOUR does not hold user funds and does not run a user escrow. Built on World Chain with World ID, MiniKit, and XMTP encrypted messaging.

## Category
Earn

## Support Email
omorke@gmail.com

## App URL
https://world-relay.vercel.app

## Assets
- App Icon: public/app-icon.png (512x512)
- Content Card: public/content-card.png (1035x720; source public/content-card.svg)
- Showcase: public/showcase-1.png, showcase-2.png, showcase-3.png (sources: *-feed / *-verify / *-chat.svg)

## Integration Details
- World ID: Orb + Device + Wallet verification for claiming (tier-gated access)
- MiniKit: walletAuth and native World App UX (haptics, share, permissions)
- World Chain: campaign USDC payouts sent directly to the runner's wallet (no user-fund escrow contract)
- XMTP: Encrypted task threads and AI chat bot

## Custody / contracts (for reviewers)

**FAVOUR does not take custody of user funds.** There is no user-deposit escrow in the live product. A previously advertised escrow path is retired (`CUSTODY_RETIRED`); the app will not encode or accept new escrow deposits. Historical on-chain rows may still settle leave-paths for old tasks only.

Do not list or require verification of a user-escrow contract for this listing. Campaign cash is a FAVOUR-funded direct ERC-20 transfer after the clean unlock gate (Orb-verified + passed verification, no AI/stock/screenshot, no flags).

---

## Changelog (since last review)

### v2.2 — 2026-07-28

**Custody retired (addresses "verify all contracts" rejection):**
- User USDC escrow deposit / fund / bind paths are closed in UI and API (410 / no-op encoders)
- Store copy and assets no longer claim that agents or users lock USDC in an escrow contract
- Wrong legacy address `0xc976…` removed from submission materials
- Product truth: points-first favours + optional FAVOUR-funded campaign USDC to wallet

**Copy / brand:**
- App name FAVOUR (RELAY rename is copy/metadata only)
- Terms, privacy, and onboarding already state: no custody, no fee on rewards

**Tested flows (dev / World App where applicable):**
- Post points favour ✓
- Claim + submit photo proof + AI verification ✓
- Campaign unlock USDC (direct payout, not escrow) ✓
- Escrow fund / create-and-fund MiniKit paths blocked ✓

### v2.1 — 2026-05-01

**Transaction / UX (historical):**
- MiniKit v2 `userOpHash` handling, visible error/success banners, haptic feedback
- Claim flow error messages and disabled states during processing
- Daily cron jobs restored; standalone packages excluded from Next.js typecheck
