# contracts-v3: FAVOUR v3 (FavourPots) + PERFECT (PerfectRounds)

Local only. Nothing deployed. Spec: ../docs/CHAIN-SCOPE-2NOV.md (v2, KEPT 2 Nov), design: ../docs/CHAIN-DESIGN-2NOV.md.

- `./setup-libs.sh` vendors OpenZeppelin 5.1.0 (contracts + upgradeable) and forge-std from local git checkouts.
- `forge test --no-match-path 'test/fork/*'`: unit, fuzz, invariant, upgrade-timelock tests.
- `forge test --match-path 'test/fork/*'`: World Chain mainnet fork (pinned block 37138477, real USDC + Permit2).
- `python3 test/mutants.py`: plants 13 bugs one by one; each must make a test fail.
- `layout/*.json`: storage layout snapshot (all state is ERC-7201 namespaced; sequential layout is empty). Diff before any upgrade.
- Review: REVIEW-ANSWERS.md, raw review/codex-2nov.txt.
