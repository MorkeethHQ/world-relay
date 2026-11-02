# FAVOUR v3 + PERFECT factory, one page, 2 Nov 2026

Spec = CHAIN-SCOPE-2NOV.md (IN rows only). Nothing deployed. Mainnet only after Oscar's GO, and he signs.
Left to Oscar, not invented here: the v3 admin address and the PERFECT fee address (constructor parameters).

## FAVOUR v3: `FavourPots` (one immutable contract)

- **Campaign pot.** `openCampaign(token, capPerFavour, slots, releaser, deadline)`: anyone (admin, maker, maker's agent). The opener owns the pot.
  `fundCampaign(id, amount)` (plain or Permit2): anyone tops up. Admin page = open + fund, two taps.
- **Payout from a pot.** `payFromPot(id, favourKey, recipient, amount)`: by the campaign owner or its releaser (the FAVOUR AI review key).
  amount <= capPerFavour, each favourKey paid once, at most `slots` payouts. Recipient is chosen here, at release.
- **Single favour.** `fundFavour(favourKey, token, amount, releaser, deadline)` (plain or Permit2): one user escrow.
  `releaseFavour(favourKey, recipient)` by funder or its named releaser. `refundFavour` after deadline, anyone triggers, money only goes to the funder.
- **Clawback.** Campaign owner `closeCampaign(id)` takes back the unspent pot at any time (8 Oct: depositor can claw back).
- **Fee.** `payoutFeeBps`, admin-set, starts 0, hard max 500 (5%), only on payouts, never on deposit, snapshotted per campaign at open.
- **Tokens.** Admin allowlist (USDC, WLD). Minimum 0.1 USDC per payout, or the token's own minimum.
- **Admin powers:** allowlist, fee for new campaigns, pause new deposits, two-step handover. Admin can never touch a pot it does not own or any user escrow.

## PERFECT: `PerfectPotFactory` + one `PerfectPot` per round

- **Anyone deploys** `createPot(token, entryPrice, closeTime, recorder, challengeWindow, resultDeadline)`.
  The factory stamps `feeBps` and `feeRecipient` into the pot as immutables. Owner can change them for future pots only. Hard max 1000 (10%).
- **Money in.** `buyBundle()` (3 tries for entryPrice, plain or Permit2), `sponsor(amount)`.
- **Winner proof (trusted, said plainly).** The recorder (game server) registers finished attempts (free or paid) with an attempt hash, then `proposeWinner(attemptHash, boardHash)`.
  After `challengeWindow` anyone calls `settle()`. The contract proves only: the winner is a registered attempt of this round, and the timing. It does not prove the score.
- **Escapes.** No proposal by `resultDeadline` → anyone `cancel()`s → every buyer and sponsor gets their full money back, no fee. The creator can cancel during the challenge window.
- **Payout is pull, not push.** Settle credits winner and fee address; each `claim()`s. A blocked address cannot freeze anyone else.

## Threats

| Threat | Where | Answer |
|---|---|---|
| Who can drain | FAVOUR releaser key is a server hot key | Cap per favour x slots bounds the loss to one pot; owner closes the pot; never user escrows |
| Who can drain | PERFECT recorder lies about the winner | Winner must be a registered attempt; challenge window; creator cancel; recorder is per round |
| Front-running | Someone buys in after seeing results | Buys close at closeTime; proposal only after closeTime |
| Front-running | Fee changed before a round opens | Fee is copied into each pot at deploy and never changes |
| Stuck pot | Recorder disappears | Timeout cancel by anyone, full refunds |
| Stuck pot | Winner or fee address blocked by the token | Pull claims; the rest still settle |
| Wrong winner | Server bug | Challenge window + creator cancel; after settle it is final (stated in the app) |
| Accounting | Any bug | Invariant tested: token balance >= all pots + all open escrows (FAVOUR), >= all credits (PERFECT) |

## Test plan (runs after the scope ruling)

- Fork World Chain 480 at a pinned block via `vm.createSelectFork`, real USDC (6 dec) and WLD (0x2cFc…3003, 18 dec), real Permit2 (0x0000…8BA3, code present, read 2 Nov).
- Unit: every function, every revert, 0.1 USDC amounts, both tokens, both pay paths.
- Fuzz: amounts, caps, slots, deadlines, fee bps up to the max.
- Invariant (handler-based): FAVOUR `balanceOf(this) >= Σ pots + Σ open escrows`, admin never moves user escrow; PERFECT `balanceOf(pot) >= Σ credits`, fee never above the stamped bps, refunds sum to deposits on cancel.
- Second-model review: `codex exec` (headless, verified working 2 Nov) on both contracts; each finding answered in REVIEW-ANSWERS.md.
- Setup note: this worktree's `contracts/lib/openzeppelin-contracts` is an empty submodule; copy it from the favour release worktree, no `forge install`.
