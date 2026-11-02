# Second-model review, answered, 2 Nov 2026

Reviewer: Codex (`codex exec`, read-only sandbox), on src/ManagedUpgradeable.sol, src/FavourPots.sol, src/PerfectRounds.sol at commit e813850.
Raw output: review/codex-2nov.txt.
Result: 6 findings (2 medium, 2 low, 2 info). 4 fixed with a regression test each, 2 accepted as stated trust-model limits.

| ID | Sev | Finding | Answer | Proof |
|---|---|---|---|---|
| F-01 | medium | Single-favour keys were global, so anyone could fund a key first and block the real funder forever | **FIXED.** Escrow id is now `keccak256(funder, key)`; `fundFavour` returns it; release, refund and `getFavour` take the id | `test_frontrun_same_key_by_other_account_does_not_block`; mutant M11 |
| F-02 | medium | Operator could open a round with a 0 challenge window and settle its own result in one block | **FIXED.** Admin-set `minChallengeWindow` (starts at 1 hour, max 7 days); `openRound` rejects anything shorter; operator cannot change it | `test_operator_cannot_skip_challenge_window`, `test_only_admin_sets_min_challenge_window`; mutant M12 |
| F-03 | low | uint256 amounts were cast to uint128 without a check, so a giant amount could be silently truncated | **FIXED.** `SafeCast.toUint128` on campaign balance, total funded and round pot | `test_huge_amount_reverts_not_truncates` |
| F-04 | low | Pro-rata refunds left rounding dust locked forever | **FIXED.** Contributors are counted; the last one to claim gets the exact remainder. The refund fuzz test now asserts refunds equal the remainder exactly | `test_refund_rounding_remainder_goes_to_last_claimer`, `testFuzz_pro_rata_refunds_never_exceed_remaining`; mutant M13 |
| F-05 | info | The 6 hour upgrade delay is notice, not a guaranteed exit: campaign contributors cannot force a close, round buyers cannot cancel early | **ACCEPTED, wording fixed.** Under the trust model Oscar chose (admin is the owner, agents hold it until > 1000 USDC), the delay is public notice plus time for the admin's own users to see it. The design doc no longer says users can always exit first. Single-favour funders can still release to themselves | CHAIN-DESIGN-2NOV.md, safeguards table |
| F-06 | info | A leaked operator key can drain every unfrozen campaign pot, cap by cap, with made-up favour keys | **ACCEPTED, known.** Oscar accepted platform custody (ruling 8 Oct) and kept the release card (2 Nov 10:51). Bounds today: cap per payout, pot size, admin freeze and role revoke, events on every payout. User single-favour escrows are out of the operator's reach (invariant `invariant_admin_never_redirects_user_escrow`, unit tests). A per-campaign daily allowance is a LATER upgrade if pots grow | scope v2 F9/F10 LATER |

Reviewer's "checked and found fine" list (not re-tested by Codex, all covered by our tests): upgrade authorisation and single-use schedule, disabled implementation initializer, ERC-7201 slots (`forge inspect` shows zero sequential slots), Permit2 pulls pinned to msg.sender, fee-on-transfer rejection, fee cap and snapshots, owed vs sweep, pause never gates exits, reentrancy guards, pull-based PERFECT credits, full refunds on cancel.

## Fix re-review, 2 Nov 2026

Codex re-reviewed the fix diff e813850..6ef1c55 (review/codex-2nov-fixes.txt): F-01, F-02, F-03, F-04 all OK; last-claimer accounting checked for underflow, double pay, repeat funding and funding after close; no new finding.
Note from Codex: admin can still set the minimum challenge window to zero on purpose. Kept: that is an admin choice, emitted as MinChallengeWindowSet.
