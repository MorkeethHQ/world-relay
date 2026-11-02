# FAVOUR + PERFECT money scope, 2 Nov 2026

Why: Oscar, 2 Nov: "scope the full mechanism incl. future product features before any deploy so nothing needs redeploying."
So IN means the contract supports it from day one, even if the app turns it on later. OUT means the contract will not have it.
Source for every row: ~/.local/state/fleet/rulings.jsonl, by date. No Solidity is written until this is ruled.

## Shared (both contracts)

| # | Feature | Asked | Verdict |
|---|---|---|---|
| S1 | Amounts as small as 0.1 USDC (100000 units) | 1 Nov, 2 Nov | **IN, must** |
| S2 | USDC and WLD both accepted (token chosen per pot, from an allowlist) | 9 Oct, 27 Oct | **IN** |
| S3 | World App pay path (Permit2, one tap) next to plain approve | 19 Oct | **IN** |
| S4 | Immutable, no upgrade key | 28 Jul custody retirement | **IN** |
| S5 | Admin key starts as the agent wallet, moves to a safer wallet later (two-step handover) | 8 Oct | **IN** |
| S6 | Pause new money in; never blocks withdrawals or refunds | safety default | **IN** |
| S7 | FAVOUR native token | 8 Oct, 9 Oct (undecided) | **OUT** (S2 allowlist can add it later, no redeploy) |
| S8 | Chance or random payouts | 19 Oct (World rejects) | **OUT** |

## FAVOUR v3 (campaign pots + single favours)

| # | Feature | Asked | Verdict |
|---|---|---|---|
| F1 | Admin funds a campaign pot from a simple admin page | 8 Oct, 2 Nov | **IN** |
| F2 | Makers (or their agents) open and fund their own campaign | 8 Oct, 10 Oct | **IN** |
| F3 | Anyone tops up any campaign pot (sponsor 100 to 200 USDC) | 1 Nov | **IN** |
| F4 | A user funds one single favour into escrow | 8 Oct, 2 Nov | **IN** |
| F5 | Recipient chosen at release, not at fund time | 2 Nov order | **IN** |
| F6 | Platform key (FAVOUR AI review) releases payouts; custody accepted | 8 Oct | **IN**, capped |
| F7 | Cap per favour, and a slot count per campaign (pilot: 5 USDC x 10) | 20 Oct | **IN** |
| F8 | Depositor claws back what was not paid out | 8 Oct | **IN** |
| F9 | Fee: never on deposit, maybe small on payout; zero for the pilot | 8 Oct, 20 Oct | **IN as a setting, 0 at launch**, hard max 5% |
| F10 | Micro favours: 0.1 USDC feedback | 1 Nov | **IN** (via S1) |
| F11 | Campaign unlock micro-payments | 1 Nov | **OUT** (a plain payment, not escrow; unclear ask) |
| F12 | Paid highlight / sponsored post for makers | 8 Oct, 10 Oct | **OUT** (plain transfer to treasury) |
| F13 | Weekly project vote settlement | 28 Oct (no funds authorized) | **OUT** |
| F14 | Staking on doing a favour | 19 Oct | **OUT** (nobody asked how; revisit) |

## PERFECT (pot factory)

| # | Feature | Asked | Verdict |
|---|---|---|---|
| P1 | Anyone deploys a prize pot / round | 2 Nov | **IN** |
| P2 | Paid replay bundle (3 tries for 1 USDC or 1 WLD); price set per round | 24, 27, 28 Oct | **IN** |
| P3 | Free tries (3 per day) can still win | 28 Oct | **IN** (recorder registers them) |
| P4 | Sponsors add to the pot without playing | 20 Oct | **IN** |
| P5 | Winner gets the pot, fee in bps to Oscar, fixed per round | 2 Nov (supersedes 28 Oct "no deduction") | **IN**, hard max 10% |
| P6 | Winner proof: game server attests, board hash committed, challenge window, timeout cancels with full refunds | gates doc 28 Oct | **IN** (trusted, not trustless) |
| P7 | Refund of a late or unplayed purchase | 28 Oct | **IN** |
| P8 | Split prize (2nd, 3rd place) | never asked | **OUT** |
| P9 | Fee to the round creator | never asked | **OUT** |
| P10 | Subscriptions, ads, spin tokens | 20 Oct (killed) | **OUT** |

## Conflict for Oscar to see

28 Oct: "the entire pot goes to the winner, no hidden deductions". 2 Nov: "a fee to me".
This scope takes 2 Nov (newest) and shows the fee before anyone pays, so it is never hidden.
