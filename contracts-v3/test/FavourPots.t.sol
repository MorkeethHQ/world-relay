// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./utils/Base.t.sol";
import {FavourPots} from "../src/FavourPots.sol";
import {ManagedUpgradeable} from "../src/ManagedUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract FavourPotsTest is BaseTest {
    FavourPots internal f;

    function setUp() public {
        _deployMocks();
        f = _deployFavour(address(usdc), address(permit2));
        _fundAndApprove(admin, address(f), 10_000 * ONE);
        _fundAndApprove(alice, address(f), 10_000 * ONE);
        _fundAndApprove(bob, address(f), 10_000 * ONE);
    }

    // ---------- helpers ----------
    function _open(uint256 cap) internal returns (uint256 id) {
        vm.prank(admin);
        id = f.openCampaign(address(usdc), cap);
    }

    function _openFunded(uint256 cap, uint256 amount) internal returns (uint256 id) {
        id = _open(cap);
        vm.prank(admin);
        f.fundCampaign(id, amount);
    }

    function _fee(uint256 a) internal pure returns (uint256) {
        return (a * FEE) / 10_000;
    }

    // ---------- init ----------
    function test_init_roles_and_fee() public view {
        assertTrue(f.hasRole(f.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(f.hasRole(f.OPERATOR_ROLE(), operator));
        assertTrue(f.hasRole(f.PAUSER_ROLE(), admin));
        assertTrue(f.hasRole(f.PAUSER_ROLE(), operator));
        assertEq(f.feeBps(), FEE);
        assertEq(f.feeRecipient(), feeTo);
        assertEq(f.MAX_FEE_BPS(), 1000);
        assertEq(f.UPGRADE_DELAY(), 6 hours);
    }

    function test_initialize_twice_reverts() public {
        vm.expectRevert();
        f.initialize(stranger, stranger, stranger, 0);
    }

    function test_implementation_cannot_be_initialized() public {
        FavourPots impl = new FavourPots(f.PERMIT2());
        vm.expectRevert();
        impl.initialize(stranger, stranger, stranger, 0);
    }

    // ---------- campaigns ----------
    function test_admin_opens_and_funds_campaign() public {
        uint256 id = _openFunded(5 * ONE, 50 * ONE);
        FavourPots.Campaign memory c = f.getCampaign(id);
        assertEq(c.token, address(usdc));
        assertEq(c.cap, 5 * ONE);
        assertEq(c.balance, 50 * ONE);
        assertEq(c.feeBps, FEE);
        assertEq(f.owed(address(usdc)), 50 * ONE);
        assertEq(usdc.balanceOf(address(f)), 50 * ONE);
    }

    function test_operator_can_open_campaign() public {
        vm.prank(operator);
        uint256 id = f.openCampaign(address(usdc), ONE);
        assertEq(f.getCampaign(id).cap, ONE);
    }

    function test_stranger_cannot_open_campaign() public {
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        f.openCampaign(address(usdc), ONE);
    }

    function test_open_rejects_disallowed_token_and_bad_cap() public {
        vm.startPrank(admin);
        vm.expectRevert(ManagedUpgradeable.TokenNotAllowed.selector);
        f.openCampaign(address(0xBEEF), ONE);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.openCampaign(address(usdc), DIME - 1);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.openCampaign(address(usdc), 1000 * ONE + 1);
        vm.stopPrank();
    }

    function test_anyone_tops_up_and_contribution_tracked() public {
        uint256 id = _openFunded(ONE, 10 * ONE);
        vm.prank(alice);
        f.fundCampaign(id, 3 * ONE);
        assertEq(f.contributed(id, admin), 10 * ONE);
        assertEq(f.contributed(id, alice), 3 * ONE);
        assertEq(f.getCampaign(id).totalFunded, 13 * ONE);
    }

    function test_fund_campaign_below_minimum_reverts() public {
        uint256 id = _open(ONE);
        vm.prank(alice);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.fundCampaign(id, DIME - 1);
    }

    function test_fund_unknown_campaign_reverts() public {
        vm.prank(alice);
        vm.expectRevert(FavourPots.UnknownCampaign.selector);
        f.fundCampaign(99, ONE);
    }

    function test_fund_campaign_with_permit2() public {
        uint256 id = _open(ONE);
        vm.startPrank(alice);
        usdc.approve(address(permit2), type(uint256).max);
        permit2.approve(address(usdc), address(f), uint160(2 * ONE), 0);
        f.fundCampaignWithPermit2(id, 2 * ONE);
        vm.stopPrank();
        assertEq(f.getCampaign(id).balance, 2 * ONE);
        assertEq(f.contributed(id, alice), 2 * ONE);
    }

    // ---------- 0.1 USDC ----------
    function test_dime_campaign_end_to_end() public {
        uint256 id = _openFunded(DIME, DIME);
        vm.prank(operator);
        f.payFromPot(id, keccak256("fav-1"), carol, DIME);
        uint256 fee = _fee(DIME); // 2500 units = 0.0025 USDC
        assertEq(usdc.balanceOf(carol), DIME - fee);
        assertEq(f.feesAccrued(address(usdc)), fee);
        f.withdrawFees(address(usdc));
        assertEq(usdc.balanceOf(feeTo), fee);
        assertEq(f.owed(address(usdc)), 0);
    }

    function test_dime_single_favour_end_to_end() public {
        bytes32 k = keccak256("single-dime");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), DIME, address(0), uint64(block.timestamp + 1 days));
        vm.prank(alice);
        f.releaseFavour(k, carol);
        assertEq(usdc.balanceOf(carol), DIME - _fee(DIME));
    }

    // ---------- payouts ----------
    function test_pay_from_pot_fee_and_state() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        vm.prank(operator);
        f.payFromPot(id, keccak256("a"), carol, 4 * ONE);
        assertEq(usdc.balanceOf(carol), 4 * ONE - _fee(4 * ONE));
        assertEq(f.getCampaign(id).balance, 16 * ONE);
        assertTrue(f.isPaid(id, keccak256("a")));
        assertEq(f.owed(address(usdc)), 16 * ONE + _fee(4 * ONE));
    }

    function test_pay_same_favour_twice_reverts() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        vm.startPrank(operator);
        f.payFromPot(id, keccak256("a"), carol, ONE);
        vm.expectRevert(FavourPots.AlreadyPaid.selector);
        f.payFromPot(id, keccak256("a"), bob, ONE);
        vm.stopPrank();
    }

    function test_pay_above_cap_reverts() public {
        uint256 id = _openFunded(ONE, 20 * ONE);
        vm.prank(operator);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.payFromPot(id, keccak256("a"), carol, ONE + 1);
    }

    function test_pay_above_balance_reverts() public {
        uint256 id = _openFunded(5 * ONE, 2 * ONE);
        vm.prank(operator);
        vm.expectRevert(FavourPots.InsufficientPot.selector);
        f.payFromPot(id, keccak256("a"), carol, 3 * ONE);
    }

    function test_pay_to_zero_reverts() public {
        uint256 id = _openFunded(5 * ONE, 2 * ONE);
        vm.prank(operator);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        f.payFromPot(id, keccak256("a"), address(0), ONE);
    }

    function test_stranger_cannot_pay() public {
        uint256 id = _openFunded(5 * ONE, 2 * ONE);
        vm.prank(stranger);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        f.payFromPot(id, keccak256("a"), stranger, ONE);
    }

    function test_admin_controls_payouts_freeze_blocks_operator_not_admin() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        vm.prank(admin);
        f.setCampaignFrozen(id, true);
        vm.prank(operator);
        vm.expectRevert(FavourPots.CampaignFrozen.selector);
        f.payFromPot(id, keccak256("a"), carol, ONE);
        vm.prank(admin);
        f.payFromPot(id, keccak256("a"), carol, ONE);
        assertGt(usdc.balanceOf(carol), 0);
    }

    function test_admin_sets_cap_within_token_max() public {
        uint256 id = _openFunded(ONE, 20 * ONE);
        vm.startPrank(admin);
        f.setCampaignCap(id, 2 * ONE);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.setCampaignCap(id, 1000 * ONE + 1);
        vm.stopPrank();
        assertEq(f.getCampaign(id).cap, 2 * ONE);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.setCampaignCap(id, ONE);
    }

    function test_campaign_fee_is_snapshotted() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        vm.prank(admin);
        f.setFee(1000, feeTo);
        vm.prank(operator);
        f.payFromPot(id, keccak256("a"), carol, 4 * ONE);
        assertEq(usdc.balanceOf(carol), 4 * ONE - _fee(4 * ONE)); // old 2.5%, not 10%
    }

    // ---------- close and refunds ----------
    function test_close_and_pro_rata_refund() public {
        uint256 id = _openFunded(5 * ONE, 30 * ONE);
        vm.prank(alice);
        f.fundCampaign(id, 10 * ONE); // total 40, admin 30 / alice 10
        vm.prank(operator);
        f.payFromPot(id, keccak256("a"), carol, 4 * ONE); // remaining 36
        vm.prank(admin);
        f.closeCampaign(id);
        uint256 a0 = usdc.balanceOf(admin);
        vm.prank(admin);
        f.claimCampaignRefund(id);
        vm.prank(alice);
        f.claimCampaignRefund(id);
        assertEq(usdc.balanceOf(admin) - a0, 27 * ONE);
        assertEq(usdc.balanceOf(alice), 10_000 * ONE - 10 * ONE + 9 * ONE);
        vm.prank(alice);
        vm.expectRevert(FavourPots.NothingToClaim.selector);
        f.claimCampaignRefund(id);
    }

    function test_closed_campaign_rejects_funding_and_payouts() public {
        uint256 id = _openFunded(5 * ONE, 10 * ONE);
        vm.prank(admin);
        f.closeCampaign(id);
        vm.prank(alice);
        vm.expectRevert(FavourPots.CampaignClosed.selector);
        f.fundCampaign(id, ONE);
        vm.prank(admin);
        vm.expectRevert(FavourPots.CampaignClosed.selector);
        f.payFromPot(id, keccak256("a"), carol, ONE);
    }

    function test_only_admin_closes() public {
        uint256 id = _openFunded(5 * ONE, 10 * ONE);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.closeCampaign(id);
    }

    function test_refund_before_close_reverts() public {
        uint256 id = _openFunded(5 * ONE, 10 * ONE);
        vm.prank(admin);
        vm.expectRevert(FavourPots.CampaignOpen.selector);
        f.claimCampaignRefund(id);
    }

    // ---------- single favours ----------
    function test_single_favour_release_by_funder_to_chosen_recipient() public {
        bytes32 k = keccak256("s1");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), 3 * ONE, address(0), uint64(block.timestamp + 7 days));
        assertEq(f.owed(address(usdc)), 3 * ONE);
        vm.prank(alice);
        f.releaseFavour(k, carol);
        assertEq(usdc.balanceOf(carol), 3 * ONE - _fee(3 * ONE));
        assertEq(uint8(f.getFavour(k).status), uint8(FavourPots.FavourStatus.Released));
    }

    function test_single_favour_release_by_named_releaser() public {
        bytes32 k = keccak256("s2");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), ONE, operator, uint64(block.timestamp + 7 days));
        vm.prank(operator);
        f.releaseFavour(k, carol);
        assertGt(usdc.balanceOf(carol), 0);
    }

    function test_single_favour_release_by_stranger_or_admin_reverts() public {
        bytes32 k = keccak256("s3");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), ONE, address(0), uint64(block.timestamp + 7 days));
        vm.prank(stranger);
        vm.expectRevert(FavourPots.NotFunderOrReleaser.selector);
        f.releaseFavour(k, stranger);
        vm.prank(admin); // admin can refund to funder, never redirect user money
        vm.expectRevert(FavourPots.NotFunderOrReleaser.selector);
        f.releaseFavour(k, admin);
    }

    function test_single_favour_duplicate_key_reverts() public {
        bytes32 k = keccak256("s4");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), ONE, address(0), uint64(block.timestamp + 7 days));
        vm.prank(bob);
        vm.expectRevert(FavourPots.FavourExists.selector);
        f.fundFavour(k, address(usdc), ONE, address(0), uint64(block.timestamp + 7 days));
    }

    function test_single_favour_bad_deadline_reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(FavourPots.DeadlineInvalid.selector);
        f.fundFavour(keccak256("d1"), address(usdc), ONE, address(0), uint64(block.timestamp));
        vm.expectRevert(FavourPots.DeadlineInvalid.selector);
        f.fundFavour(keccak256("d2"), address(usdc), ONE, address(0), uint64(block.timestamp + 181 days));
        vm.stopPrank();
    }

    function test_single_favour_refund_after_deadline_by_anyone_goes_to_funder() public {
        bytes32 k = keccak256("s5");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), 2 * ONE, address(0), uint64(block.timestamp + 1 days));
        vm.prank(stranger);
        vm.expectRevert(FavourPots.NotExpired.selector);
        f.refundFavour(k);
        vm.warp(block.timestamp + 1 days + 1);
        uint256 b0 = usdc.balanceOf(alice);
        vm.prank(stranger);
        f.refundFavour(k);
        assertEq(usdc.balanceOf(alice) - b0, 2 * ONE); // no fee on refunds
        assertEq(f.owed(address(usdc)), 0);
    }

    function test_admin_can_refund_single_favour_early_to_funder() public {
        bytes32 k = keccak256("s6");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), 2 * ONE, address(0), uint64(block.timestamp + 10 days));
        uint256 b0 = usdc.balanceOf(alice);
        vm.prank(admin);
        f.refundFavour(k);
        assertEq(usdc.balanceOf(alice) - b0, 2 * ONE);
    }

    function test_single_favour_above_max_reverts() public {
        vm.prank(alice);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.fundFavour(keccak256("big"), address(usdc), 1000 * ONE + 1, address(0), uint64(block.timestamp + 1 days));
    }

    function test_single_favour_with_permit2() public {
        bytes32 k = keccak256("p2");
        vm.startPrank(bob);
        usdc.approve(address(permit2), type(uint256).max);
        permit2.approve(address(usdc), address(f), uint160(ONE), 0);
        f.fundFavourWithPermit2(k, address(usdc), ONE, address(0), uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertEq(f.getFavour(k).funder, bob);
    }

    function test_double_release_and_release_after_refund_revert() public {
        bytes32 k = keccak256("s7");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), ONE, address(0), uint64(block.timestamp + 1 days));
        vm.prank(alice);
        f.releaseFavour(k, carol);
        vm.prank(alice);
        vm.expectRevert(FavourPots.FavourNotFunded.selector);
        f.releaseFavour(k, carol);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(FavourPots.FavourNotFunded.selector);
        f.refundFavour(k);
    }

    // ---------- fees ----------
    function test_fee_cap_enforced() public {
        vm.startPrank(admin);
        vm.expectRevert(ManagedUpgradeable.FeeTooHigh.selector);
        f.setFee(1001, feeTo);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        f.setFee(100, address(0));
        f.setFee(1000, feeTo);
        vm.stopPrank();
        assertEq(f.feeBps(), 1000);
    }

    function test_operator_cannot_set_fee() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.setFee(0, operator);
    }

    function test_set_token_min_must_be_nonzero_and_le_max() public {
        vm.startPrank(admin);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.setToken(address(usdc), true, 0, ONE);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.setToken(address(usdc), true, 2 * ONE, ONE);
        vm.stopPrank();
    }

    // ---------- pause ----------
    function test_pause_blocks_money_in_only() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        bytes32 k = keccak256("pz");
        vm.prank(alice);
        f.fundFavour(k, address(usdc), ONE, address(0), uint64(block.timestamp + 1 days));
        vm.prank(operator);
        f.pause();

        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        f.fundCampaign(id, ONE);
        vm.prank(admin);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        f.openCampaign(address(usdc), ONE);
        vm.prank(alice);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        f.fundFavour(keccak256("pz2"), address(usdc), ONE, address(0), uint64(block.timestamp + 1 days));

        // exits all still work while paused
        vm.prank(operator);
        f.payFromPot(id, keccak256("x"), carol, ONE);
        vm.prank(alice);
        f.releaseFavour(k, carol);
        f.withdrawFees(address(usdc));
        vm.prank(admin);
        f.closeCampaign(id);
        vm.prank(admin);
        f.claimCampaignRefund(id);
        assertEq(f.owed(address(usdc)), 0);
    }

    function test_only_admin_unpauses() public {
        vm.prank(operator);
        f.pause();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.unpause();
        vm.prank(admin);
        f.unpause();
        assertFalse(f.paused());
    }

    // ---------- blocked address ----------
    function test_blocked_recipient_does_not_freeze_others() public {
        uint256 id = _openFunded(5 * ONE, 20 * ONE);
        usdc.setBlocked(carol, true);
        vm.prank(operator);
        vm.expectRevert();
        f.payFromPot(id, keccak256("a"), carol, ONE);
        vm.prank(operator);
        f.payFromPot(id, keccak256("a"), bob, ONE); // same favour, another worker
        assertTrue(f.isPaid(id, keccak256("a")));
        assertEq(usdc.balanceOf(bob), 10_000 * ONE + ONE - _fee(ONE));
    }

    // ---------- sweep ----------
    function test_sweep_only_takes_excess() public {
        _openFunded(5 * ONE, 20 * ONE);
        usdc.mint(address(f), 7 * ONE); // stray transfer
        vm.prank(admin);
        f.sweepExcess(address(usdc), admin);
        assertEq(usdc.balanceOf(address(f)), 20 * ONE);
        vm.prank(admin);
        vm.expectRevert(ManagedUpgradeable.NothingToClaim.selector);
        f.sweepExcess(address(usdc), admin);
    }

    // ---------- fuzz ----------
    function testFuzz_payout_fee_math(uint256 amount, uint16 bps) public {
        bps = uint16(bound(bps, 0, 1000));
        amount = bound(amount, DIME, 1000 * ONE);
        vm.prank(admin);
        f.setFee(bps, feeTo);
        uint256 id = _openFunded(1000 * ONE, amount);
        vm.prank(operator);
        f.payFromPot(id, keccak256("z"), carol, amount);
        uint256 fee = (amount * bps) / 10_000;
        assertEq(usdc.balanceOf(carol), amount - fee);
        assertEq(f.feesAccrued(address(usdc)), fee);
        assertLe(fee * 10_000, amount * 1000);
        assertEq(usdc.balanceOf(address(f)), f.owed(address(usdc)));
    }

    function testFuzz_setFee_never_above_cap(uint16 bps) public {
        vm.prank(admin);
        if (bps > 1000) {
            vm.expectRevert(ManagedUpgradeable.FeeTooHigh.selector);
            f.setFee(bps, feeTo);
        } else {
            f.setFee(bps, feeTo);
            assertEq(f.feeBps(), bps);
        }
    }

    function testFuzz_pro_rata_refunds_never_exceed_remaining(uint96 a, uint96 b, uint96 spend) public {
        uint256 aa = bound(a, DIME, 1000 * ONE);
        uint256 bb = bound(b, DIME, 1000 * ONE);
        uint256 id = _openFunded(1000 * ONE, aa);
        vm.prank(alice);
        f.fundCampaign(id, bb);
        uint256 s = bound(spend, 0, aa + bb < 1000 * ONE ? aa + bb : 1000 * ONE);
        if (s >= DIME) {
            vm.prank(operator);
            f.payFromPot(id, keccak256("s"), carol, s);
        } else {
            s = 0;
        }
        vm.prank(admin);
        f.closeCampaign(id);
        uint256 before = usdc.balanceOf(admin) + usdc.balanceOf(alice);
        vm.prank(admin);
        f.claimCampaignRefund(id);
        vm.prank(alice);
        f.claimCampaignRefund(id);
        uint256 got = usdc.balanceOf(admin) + usdc.balanceOf(alice) - before;
        uint256 remaining = aa + bb - s;
        assertLe(got, remaining);
        assertGe(got + 2, remaining); // at most 1 unit of rounding dust per contributor
        assertGe(usdc.balanceOf(address(f)), f.owed(address(usdc)));
    }

    function testFuzz_single_favour_deadline(uint64 d) public {
        d = uint64(bound(d, 0, 400 days));
        uint64 deadline = uint64(block.timestamp) + d;
        vm.prank(alice);
        if (d == 0 || d > 180 days) {
            vm.expectRevert(FavourPots.DeadlineInvalid.selector);
            f.fundFavour(keccak256("fd"), address(usdc), ONE, address(0), deadline);
        } else {
            f.fundFavour(keccak256("fd"), address(usdc), ONE, address(0), deadline);
            vm.warp(deadline);
            vm.expectRevert(FavourPots.NotExpired.selector);
            f.refundFavour(keccak256("fd"));
            vm.warp(uint256(deadline) + 1);
            f.refundFavour(keccak256("fd"));
        }
    }
}
