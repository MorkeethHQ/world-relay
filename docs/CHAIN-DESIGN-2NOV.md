# FAVOUR v3 + PERFECT, one page, v2, 2 Nov 2026

Spec = CHAIN-SCOPE-2NOV.md v2 (NOW rows). Nothing deployed. Mainnet only after Oscar's GO, and he signs.
Not invented here: the admin Safe owners and the PERFECT fee address.

## Proxy: UUPS, one proxy per app

- **Which:** OpenZeppelin v5 `UUPSUpgradeable` behind an `ERC1967Proxy`. One for `FavourPots`, one for `PerfectRounds`.
- **Why UUPS, not transparent:** one admin, so the transparent pattern's separate ProxyAdmin buys nothing; UUPS calls are cheaper; OZ v5 refuses an upgrade to a contract that is not itself upgradeable (bricking guard); the old Relay contract on World Chain already runs UUPS, so the tooling is known.
- **Storage:** ERC-7201 namespaced storage, so later features add fields without shifting old ones. `forge inspect` storage-layout diff is a gate before every upgrade.

## Roles (OZ AccessControl)

| Role | Holder | Can |
|---|---|---|
| ADMIN | Oscar; agent wallet until > 1000 USDC deployed | upgrade (through the timelock), change settings within code caps, grant roles, and everything OPERATOR can do: pay out, stop or cancel payouts (Oscar 10:51) |
| OPERATOR | agent / server key | open FAVOUR campaigns and PERFECT rounds, pay out within caps, register attempts, propose winners |
| PAUSER | ADMIN and OPERATOR | pause new money in; never pauses refunds, claims or withdrawals |

## Settings (change instantly, by ADMIN, each emits an event)

fee bps (2.5% on payouts in both apps, Oscar KEPT 10:50 to 10:51; never on deposit), minimum amount (0.1 USDC), cap per favour, allowed tokens (USDC now, WLD later), challenge window, timeouts.
Hard caps written in code: fee <= 10%, minimum >= 0.01 USDC. A round or campaign copies its fee when it opens, so a fee change never hits money already in.

## FAVOUR v3: `FavourPots`

- OPERATOR opens a campaign; anyone funds it (plain approve or Permit2); OPERATOR pays a favour from it to a recipient chosen at payout, at most the cap, each favour once.
- ADMIN closes a campaign and takes the unspent pot back to the funding wallet it came from.
- A user funds a single favour (plain or Permit2); its id is keccak256(funder, key), so nobody can squat a key (Codex F-01); the user (or the review key the user named) releases it to a recipient chosen then; after the deadline anyone can trigger a refund, which only goes to the user.

## PERFECT: `PerfectRounds` (Oscar 10:50: admin opens rounds, everyone pays in and is paid out)

- OPERATOR opens a round: token, entry price, close time, challenge window (at least the admin-set floor, 1 h at start; Codex F-02). Fee copied in.
- Anyone buys entries (plain or Permit2) or sponsors the pot.
- Winner, said plainly: the game server registers finished attempts (free or paid) and proposes the winning attempt plus a board hash. After the challenge window anyone settles. The contract proves the winner is a registered attempt of that round and the timing; it does not prove the score.
- No proposal by the deadline: anyone cancels, everyone gets their full money back, no fee.
- Payout by claim: winner and fee address each pull their share; a blocked address cannot freeze others.

## What upgradeability costs, and the safeguards

An upgrade can rewrite any rule, including the hard caps. So the caps bind only between upgrades; the real guard is who can upgrade and how fast.

| Safeguard | Proposal | Card |
|---|---|---|
| Timelock on upgrades | 6 h delay on upgrades only (Oscar, 2 Nov 10:54); settings and pause stay instant. It is public notice (UpgradeScheduled event), not a guaranteed exit: open campaign pots and running rounds cannot be forced shut by users (Codex F-05). Refunds, claims and closes are never pausable | chain-design-timelock-2nov (EDIT: 6 h) |
| Multisig | Not now (Oscar, 2 Nov 10:54): agents hold ADMIN until more than 1000 USDC is deployed, then switch to a safer wallet (role handover tested) | chain-design-multisig-2nov (EDIT) |
| Events | Every setting change, role change, pause and upgrade emits an event | always on, no card |
| Fee cap in code | 10% hard cap, fee copied per round or campaign | chain-design-fee-2nov-v2 |

## Threats

| Threat | Answer |
|---|---|
| Admin key stolen | 6 h upgrade delay; settings capped in code; move admin to a safer wallet past 1000 USDC |
| Operator (server) key stolen | Can pay out at most the cap per favour, from open pots only; never user escrows; ADMIN revokes the role |
| Bad upgrade | OZ upgrade-safety check + storage-layout diff + fork test of the new version before the Safe signs |
| Front-running a fee change | Fee copied into each round or campaign when it opens |
| Recorder disappears | Timeout cancel by anyone, full refunds |
| Wrong winner | Challenge window, OPERATOR or ADMIN can cancel before settle; final after |
| Blocked address | Claims are pulled, one by one |
| Accounting bug | Invariant: token balance >= all pots + open escrows (FAVOUR), >= all credits (PERFECT), checked again after a test upgrade |

## Test plan (runs after the scope ruling)

- Fork World Chain 480 at a pinned block via `vm.createSelectFork`, real USDC (6 dec) and WLD (0x2cFc…3003, 18 dec), real Permit2 (0x0000…8BA3, code present, read 2 Nov).
- Unit: every function, every revert, 0.1 USDC amounts, both tokens, both pay paths.
- Fuzz: amounts, caps, slots, deadlines, fee bps up to the max.
- Upgrade tests: deploy v1 behind the proxy, fund, upgrade to a v2 mock, check every balance and record survives; unauthorized upgrade reverts; timelock delay enforced.
- Invariant (handler-based): FAVOUR `balanceOf(this) >= Σ pots + Σ open escrows`, admin never moves user escrow; PERFECT `balanceOf(pot) >= Σ credits`, fee never above the stamped bps, refunds sum to deposits on cancel.
- Second-model review: `codex exec` (headless, verified working 2 Nov) on both contracts; each finding answered in REVIEW-ANSWERS.md.
- Setup note: this worktree's `contracts/lib/openzeppelin-contracts` is an empty submodule; copy it from the favour release worktree, no `forge install`.
