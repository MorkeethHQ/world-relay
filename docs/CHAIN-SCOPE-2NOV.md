# FAVOUR + PERFECT money scope, v2, 2 Nov 2026

Oscar, 2 Nov 10:49, EDIT on v1: "we want to keep the contract flexible and upgradeable so we can manage it, its a consumer app so lets take it as we go".
So: contracts are upgradeable. **NOW** = in the first version. **LATER** = added by an upgrade when the app needs it. **OUT** = never.
Source for every ask: ~/.local/state/fleet/rulings.jsonl, by date. No Solidity until v2 is kept.

## Shared (both contracts)

| # | Feature | Asked | v2 |
|---|---|---|---|
| S1 | Amounts as small as 0.1 USDC (a minimum the admin can change) | 1, 2 Nov | **NOW, must** |
| S2 | Upgradeable behind a proxy, admin role Oscar controls | 2 Nov | **NOW** |
| S3 | Settings the admin changes without an upgrade: fee bps (hard cap in code), minimum, cap per favour, allowed tokens | 2 Nov | **NOW** |
| S4 | Pause new money in; never blocks withdrawals or refunds | 2 Nov | **NOW** |
| S5 | World App one-tap pay (Permit2) next to plain approve | 19 Oct | **NOW** |
| S6 | USDC at launch; WLD is one admin setting away (allowed tokens) | 9, 27 Oct | **NOW** (USDC), WLD by setting |
| S7 | Every admin change and upgrade emits an event | safeguard | **NOW** |
| S8 | FAVOUR native token | 8, 9 Oct (undecided) | **LATER** |
| S9 | Chance or random payouts | 19 Oct (World rejects) | **OUT** |

## FAVOUR v3

| # | Feature | Asked | v2 |
|---|---|---|---|
| F1 | Admin opens and funds a campaign pot from a simple admin page | 8 Oct, 2 Nov | **NOW** |
| F2 | Anyone tops up a campaign pot (sponsor) | 1 Nov | **NOW** |
| F3 | A user funds one single favour into escrow | 2 Nov | **NOW** |
| F4 | Recipient chosen at payout | 2 Nov | **NOW** |
| F5 | FAVOUR review key pays out, capped per favour, each favour once; admin can also pay out, stop or cancel any payout from a pot | 8, 20 Oct; 2 Nov 10:51 "as an admin i also need to be able to control them" | **NOW** |
| F6 | Unpaid money goes back to who put it in (pot close, escrow refund after deadline) | 8 Oct | **NOW** |
| F7 | Fee to Oscar on FAVOUR payouts too, never on deposit, same 10% hard cap | 8 Oct; 2 Nov 10:51 "and a fee here too" | **NOW** (2.5%, setting) |
| F8 | Makers or their agents open their own campaigns | 8, 10 Oct | **LATER** |
| F9 | Slot count per campaign | 20 Oct | **LATER** (pot size and cap do the job) |
| F10 | Unlock micro-payments, paid highlights, vote settlement, staking | 1 Nov, 8, 28, 19 Oct | **LATER** |

## PERFECT

| # | Feature | Asked | v2 |
|---|---|---|---|
| P1 | Admin opens rounds; anyone pays in to activate more rounds and can be paid out | 2 Nov 10:50 deploy-card note | **NOW** |
| P1b | Anyone opens their own pot | 2 Nov order, then 10:50 note "for now people dont need to be able to create pots" | **LATER** (new games by upgrade) |
| P2 | Paid entry (bundle of tries), price set per round | 24, 27, 28 Oct | **NOW** |
| P3 | Free tries can win (game server registers them) | 28 Oct | **NOW** |
| P4 | Sponsors add to the pot | 20 Oct | **NOW** |
| P5 | Winner paid, fee to Oscar, fee copied into the round when it opens | 2 Nov | **NOW** |
| P6 | Winner attested by the game server, waiting window, timeout gives full refunds | 28 Oct gates | **NOW** |
| P7 | Refund of a late or unplayed purchase | 28 Oct | **LATER** (timeout refund covers the stuck case) |
| P8 | Split prizes, creator fee, subscriptions, ads, spin tokens | not asked or killed 20 Oct | **LATER** / OUT |

## Changed from v1

- Oscar's 10:50 to 10:51 KEEPs folded in: PERFECT fee 2.5% kept; FAVOUR pot gets a fee too (F7); admin controls payouts (F5).

- "Immutable, no upgrade key" flipped to upgradeable (S2).
- 4 items moved from NOW to LATER: anyone opening a PERFECT pot (P1b, per Oscar's 10:50 note), makers opening campaigns (F8), slot counts (F9), late-purchase refunds (P7).
- Oscar's 10:50 note ends mid-sentence at "Favour they need to". The FAVOUR half is unknown; F1 to F7 stay as they were until he finishes it.
- Most v1 OUT items are now LATER (token, unlock payments, highlights, vote settlement, staking, split prizes). Only chance payouts stay OUT.
- WLD is no longer a separate build: it is one admin setting (S6).
- Fee conflict still stands: 28 Oct "whole pot to the winner" vs 2 Nov "fee to me". v2 follows 2 Nov.
