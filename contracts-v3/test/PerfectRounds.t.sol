// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./utils/Base.t.sol";
import {PerfectRounds} from "../src/PerfectRounds.sol";
import {ManagedUpgradeable} from "../src/ManagedUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract PerfectRoundsTest is BaseTest {
    PerfectRounds internal r;
    uint64 internal closeT;
    uint64 internal deadlineT;
    uint32 internal constant WINDOW = 1 hours;

    function setUp() public {
        _deployMocks();
        r = _deployPerfect(address(usdc), address(permit2));
        _fundAndApprove(alice, address(r), 1000 * ONE);
        _fundAndApprove(bob, address(r), 1000 * ONE);
        _fundAndApprove(carol, address(r), 1000 * ONE);
        closeT = uint64(block.timestamp + 1 days);
        deadlineT = closeT + 1 days;
    }

    function _open(uint256 price) internal returns (uint256 id) {
        vm.prank(operator);
        id = r.openRound(address(usdc), price, closeT, deadlineT, WINDOW);
    }

    function _fee(uint256 a) internal pure returns (uint256) {
        return (a * FEE) / 10_000;
    }

    /// alice buys 2 bundles, bob 1, carol sponsors 5; bob wins with a free-or-paid attempt.
    function _playedRound() internal returns (uint256 id, uint256 pot) {
        id = _open(ONE);
        vm.prank(alice);
        r.buyEntries(id, 2);
        vm.prank(bob);
        r.buyEntries(id, 1);
        vm.prank(carol);
        r.sponsor(id, 5 * ONE);
        pot = 8 * ONE;
        vm.startPrank(operator);
        r.registerAttempt(id, alice, keccak256("a1"));
        r.registerAttempt(id, bob, keccak256("b1"));
        r.registerAttempt(id, stranger, keccak256("free1")); // free try, never paid
        vm.stopPrank();
    }

    // ---------- open ----------
    function test_operator_opens_round_fee_snapshotted() public {
        uint256 id = _open(ONE);
        PerfectRounds.Round memory rd = r.getRound(id);
        assertEq(rd.entryPrice, ONE);
        assertEq(rd.feeBps, FEE);
        assertEq(uint8(rd.status), uint8(PerfectRounds.RoundStatus.Open));
    }

    function test_stranger_cannot_open_round() public {
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, WINDOW);
    }

    function test_open_rejects_bad_times_and_price() public {
        vm.startPrank(admin);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, uint64(block.timestamp), deadlineT, WINDOW);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, closeT, WINDOW);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, closeT + 31 days, WINDOW);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, 8 days);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        r.openRound(address(usdc), DIME - 1, closeT, deadlineT, WINDOW);
        vm.expectRevert(ManagedUpgradeable.TokenNotAllowed.selector);
        r.openRound(address(0xBEEF), ONE, closeT, deadlineT, WINDOW);
        vm.stopPrank();
    }

    // ---------- money in ----------
    function test_buy_and_sponsor_track_contributions() public {
        (uint256 id, uint256 pot) = _playedRound();
        assertEq(r.getRound(id).pot, pot);
        assertEq(r.contributed(id, alice), 2 * ONE);
        assertEq(r.contributed(id, carol), 5 * ONE);
        assertEq(r.owed(address(usdc)), pot);
    }

    function test_buy_after_close_reverts() public {
        uint256 id = _open(ONE);
        vm.warp(closeT);
        vm.prank(alice);
        vm.expectRevert(PerfectRounds.EntriesClosed.selector);
        r.buyEntries(id, 1);
        vm.prank(carol);
        vm.expectRevert(PerfectRounds.EntriesClosed.selector);
        r.sponsor(id, ONE);
    }

    function test_buy_bad_count_reverts() public {
        uint256 id = _open(ONE);
        vm.startPrank(alice);
        vm.expectRevert(PerfectRounds.BadCount.selector);
        r.buyEntries(id, 0);
        vm.expectRevert(PerfectRounds.BadCount.selector);
        r.buyEntries(id, 101);
        vm.stopPrank();
    }

    function test_sponsor_below_min_reverts() public {
        uint256 id = _open(ONE);
        vm.prank(carol);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        r.sponsor(id, DIME - 1);
    }

    function test_unknown_round_reverts() public {
        vm.prank(alice);
        vm.expectRevert(PerfectRounds.UnknownRound.selector);
        r.buyEntries(42, 1);
    }

    function test_buy_with_permit2() public {
        uint256 id = _open(ONE);
        vm.startPrank(alice);
        usdc.approve(address(permit2), type(uint256).max);
        permit2.approve(address(usdc), address(r), uint160(3 * ONE), 0);
        r.buyEntriesWithPermit2(id, 3);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        r.sponsorWithPermit2(id, 0);
        vm.stopPrank();
        assertEq(r.contributed(id, alice), 3 * ONE);
    }

    // ---------- 0.1 USDC ----------
    function test_dime_round_end_to_end() public {
        uint256 id = _open(DIME);
        vm.prank(alice);
        r.buyEntries(id, 1);
        vm.prank(operator);
        r.registerAttempt(id, alice, keccak256("d"));
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("d"), keccak256("board"));
        vm.warp(closeT + WINDOW);
        r.settle(id);
        uint256 b0 = usdc.balanceOf(alice);
        vm.prank(alice);
        r.claim(address(usdc));
        assertEq(usdc.balanceOf(alice) - b0, DIME - _fee(DIME));
        r.withdrawFees(address(usdc));
        assertEq(usdc.balanceOf(feeTo), _fee(DIME));
        assertEq(r.owed(address(usdc)), 0);
    }

    // ---------- winner ----------
    function test_full_settle_flow_free_attempt_can_win() public {
        (uint256 id, uint256 pot) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("free1"), keccak256("board"));
        vm.expectRevert(PerfectRounds.TooEarly.selector);
        r.settle(id);
        vm.warp(closeT + WINDOW);
        vm.prank(stranger);
        r.settle(id);
        assertEq(r.credits(address(usdc), stranger), pot - _fee(pot));
        assertEq(r.feesAccrued(address(usdc)), _fee(pot));
        vm.prank(stranger);
        r.claim(address(usdc));
        assertEq(usdc.balanceOf(stranger), pot - _fee(pot));
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NothingToClaim.selector);
        r.claim(address(usdc));
    }

    function test_propose_before_close_reverts() public {
        (uint256 id,) = _playedRound();
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.TooEarly.selector);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
    }

    function test_propose_unregistered_attempt_reverts() public {
        (uint256 id,) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.AttemptUnknown.selector);
        r.proposeWinner(id, keccak256("nope"), bytes32(0));
    }

    function test_propose_after_deadline_reverts() public {
        (uint256 id,) = _playedRound();
        vm.warp(deadlineT + 1);
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.TooLate.selector);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
    }

    function test_stranger_cannot_register_or_propose() public {
        (uint256 id,) = _playedRound();
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        r.registerAttempt(id, stranger, keccak256("x"));
        vm.warp(closeT);
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
    }

    function test_duplicate_attempt_reverts() public {
        (uint256 id,) = _playedRound();
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.AttemptExists.selector);
        r.registerAttempt(id, bob, keccak256("a1"));
    }

    function test_round_fee_snapshot_survives_fee_change() public {
        (uint256 id, uint256 pot) = _playedRound();
        vm.prank(admin);
        r.setFee(1000, feeTo);
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("b1"), bytes32(0));
        vm.warp(closeT + WINDOW);
        r.settle(id);
        assertEq(r.credits(address(usdc), bob), pot - _fee(pot));
    }

    // ---------- cancel and refunds ----------
    function test_operator_cancels_during_window_everyone_refunded_in_full() public {
        (uint256 id,) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
        vm.prank(admin);
        r.cancel(id);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 c0 = usdc.balanceOf(carol);
        vm.prank(alice);
        r.refund(id);
        vm.prank(carol);
        r.refund(id);
        vm.prank(bob);
        r.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 2 * ONE);
        assertEq(usdc.balanceOf(carol) - c0, 5 * ONE);
        assertEq(r.owed(address(usdc)), 0);
        assertEq(r.feesAccrued(address(usdc)), 0);
        vm.prank(alice);
        vm.expectRevert(ManagedUpgradeable.NothingToClaim.selector);
        r.refund(id);
    }

    function test_anyone_cancels_after_deadline_without_proposal() public {
        (uint256 id,) = _playedRound();
        vm.prank(stranger);
        vm.expectRevert(PerfectRounds.TooEarly.selector);
        r.cancel(id);
        vm.warp(deadlineT + 1);
        vm.prank(stranger);
        r.cancel(id);
        assertEq(uint8(r.getRound(id).status), uint8(PerfectRounds.RoundStatus.Cancelled));
    }

    function test_stranger_cannot_cancel_proposed_round() public {
        (uint256 id,) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
        vm.warp(deadlineT + 1);
        vm.prank(stranger);
        vm.expectRevert(PerfectRounds.WrongStatus.selector);
        r.cancel(id);
    }

    function test_settled_round_cannot_cancel_or_refund() public {
        (uint256 id,) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
        vm.warp(closeT + WINDOW);
        r.settle(id);
        vm.prank(admin);
        vm.expectRevert(PerfectRounds.WrongStatus.selector);
        r.cancel(id);
        vm.prank(alice);
        vm.expectRevert(PerfectRounds.WrongStatus.selector);
        r.refund(id);
    }

    // ---------- pause ----------
    function test_pause_blocks_money_in_never_exits() public {
        (uint256 id,) = _playedRound();
        uint256 id2 = _open(ONE);
        vm.prank(bob);
        r.buyEntries(id2, 1);
        vm.prank(admin);
        r.pause();
        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        r.buyEntries(id, 1);
        vm.prank(carol);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        r.sponsor(id, ONE);
        vm.prank(operator);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, WINDOW);

        // exits still work
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
        vm.warp(closeT + WINDOW);
        r.settle(id);
        vm.prank(alice);
        r.claim(address(usdc));
        r.withdrawFees(address(usdc));
        vm.prank(admin);
        r.cancel(id2);
        vm.prank(bob);
        r.refund(id2);
        assertEq(r.owed(address(usdc)), 0);
    }

    // ---------- blocked address ----------
    function test_blocked_winner_does_not_block_fee_or_others() public {
        (uint256 id,) = _playedRound();
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("a1"), bytes32(0));
        vm.warp(closeT + WINDOW);
        usdc.setBlocked(alice, true);
        r.settle(id); // settle never transfers, so it cannot be blocked
        r.withdrawFees(address(usdc));
        assertGt(usdc.balanceOf(feeTo), 0);
        vm.prank(alice);
        vm.expectRevert();
        r.claim(address(usdc));
    }

    // ---------- fuzz ----------
    function testFuzz_settle_split(uint8 bundles, uint96 sponsorAmt, uint16 bps) public {
        bps = uint16(bound(bps, 0, 1000));
        vm.prank(admin);
        r.setFee(bps, feeTo);
        uint256 n = bound(bundles, 1, 100);
        uint256 s = bound(sponsorAmt, DIME, 500 * ONE);
        uint256 id = _open(DIME);
        vm.prank(alice);
        r.buyEntries(id, n);
        vm.prank(carol);
        r.sponsor(id, s);
        vm.prank(operator);
        r.registerAttempt(id, bob, keccak256("w"));
        vm.warp(closeT);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("w"), bytes32(0));
        vm.warp(closeT + WINDOW);
        r.settle(id);
        uint256 pot = n * DIME + s;
        uint256 fee = (pot * bps) / 10_000;
        assertEq(r.credits(address(usdc), bob) + r.feesAccrued(address(usdc)), pot);
        assertEq(r.feesAccrued(address(usdc)), fee);
        assertLe(fee * 10_000, pot * 1000);
    }

    function testFuzz_cancel_refunds_sum_to_deposits(uint8 a, uint8 b, uint96 s) public {
        uint256 na = bound(a, 1, 100);
        uint256 nb = bound(b, 1, 100);
        uint256 ss = bound(s, DIME, 500 * ONE);
        uint256 id = _open(DIME);
        vm.prank(alice);
        r.buyEntries(id, na);
        vm.prank(bob);
        r.buyEntries(id, nb);
        vm.prank(carol);
        r.sponsor(id, ss);
        vm.prank(admin);
        r.cancel(id);
        vm.prank(alice);
        r.refund(id);
        vm.prank(bob);
        r.refund(id);
        vm.prank(carol);
        r.refund(id);
        assertEq(usdc.balanceOf(address(r)), 0);
        assertEq(r.owed(address(usdc)), 0);
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol), 3000 * ONE);
    }

    /// Codex F-02: the operator cannot open a round without a waiting window.
    function test_operator_cannot_skip_challenge_window() public {
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, 0);
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, 1 hours - 1);
        assertEq(r.minChallengeWindow(), 1 hours);
    }

    function test_only_admin_sets_min_challenge_window() public {
        vm.prank(operator);
        vm.expectRevert();
        r.setMinChallengeWindow(0);
        vm.startPrank(admin);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.setMinChallengeWindow(8 days);
        r.setMinChallengeWindow(2 hours);
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(PerfectRounds.BadTimes.selector);
        r.openRound(address(usdc), ONE, closeT, deadlineT, 1 hours);
    }
}
