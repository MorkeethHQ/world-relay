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

FAVOUR is non-custodial: it never holds user funds. Cash favours use an optional poster-funded escrow contract signed from the poster's own wallet. Built on World Chain with World ID, MiniKit, and XMTP encrypted messaging.

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
- World Chain: campaign USDC payouts sent directly to the runner's wallet; optional poster-funded escrow (FavourEscrowV2_1) for cash favours
- XMTP: Encrypted task threads and AI chat bot

## Custody / contracts (for reviewers)

**FAVOUR is non-custodial.** The app never holds user funds and no server key can move them. Points favours and campaign payouts move no user money at all; campaign cash is a FAVOUR-funded direct ERC-20 transfer after the clean unlock gate (Orb-verified + passed verification, no AI/stock/screenshot, no flags).

**Optional poster-funded escrow for cash favours: `FavourEscrowV2_1` at `0x61041dfC405D6CeA57653B8E8BCBDA209214682f`** — source VERIFIED on World Chain Blockscout, immutable (no proxy, no owner, no pause, no fee). The recipient is bound at fund time; the funder signs from their own wallet; funds release only to that bound recipient, or refund to the funder after the deadline. The legacy v1 escrow path is retired (`CUSTODY_RETIRED`, endpoints return 410) and the app encodes no new deposits to it.

**Portal declarations (all three):**
- Contract Entrypoints: escrow `0x61041dfC405D6CeA57653B8E8BCBDA209214682f` + Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Permit2 Tokens: USDC `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`

**Reviewer notes (how to test):** FAVOUR is non-custodial by default — posting a favour moves no money. To see the cash flow you need a second account: the Fund button appears for the poster only after a claimant accepts the favour. Once funded, the escrow can only release to the claimant the poster approves, or refund to the poster after the deadline; no other destination exists in the contract ABI. Campaign USDC requires Orb verification plus a passing photo proof, so it cannot be instant-tested from a fresh account.

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
