// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FavourReviewEscrow} from "../src/FavourReviewEscrow.sol";
import {IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {ReentrantToken, IEscrowTarget} from "./mocks/ReentrantToken.sol";

/// @dev Unit and fuzz tests for FavourReviewEscrow, grouped by failure class: who
///      may release, double release, spending past or across budgets, refund going
///      to the wrong depositor, early close, fee limits, role changes, third-party
///      allowance spend and reentrancy. Limits are read from the contract, never
///      typed in. All amounts are test fixtures, not real deposits.
contract FavourReviewEscrowTest is Test {
    FavourReviewEscrow internal escrow;
    MockUSDC internal usdc;
    MockPermit2 internal permit2;

    address internal admin = makeAddr("admin");
    address internal releaser = makeAddr("releaser");
    address internal maker = makeAddr("maker");
    address internal friend = makeAddr("friend");
    address internal reviewerA = makeAddr("reviewerA");
    address internal reviewerB = makeAddr("reviewerB");
    address internal attacker = makeAddr("attacker");
    address internal treasury = makeAddr("treasury");

    bytes32 internal constant SALT = keccak256("campaign-1");
    bytes32 internal constant C1 = keccak256("contribution-1");
    bytes32 internal constant C2 = keccak256("contribution-2");

    uint256 internal constant START = 1_000_000_000; // fixture: 1000 USDC
    uint96 internal constant DEPOSIT = 200_000_000; // fixture: 200 USDC
    uint96 internal constant REVIEW = 5_000_000; // fixture: 5 USDC
    uint64 internal deadline;
    bytes32 internal id;

    function setUp() public {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
        escrow = new FavourReviewEscrow(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2)), admin, releaser
        );
        deadline = uint64(block.timestamp + 14 days);
        address[4] memory payers = [maker, friend, admin, attacker];
        for (uint256 i = 0; i < payers.length; i++) {
            usdc.mint(payers[i], START);
            vm.startPrank(payers[i]);
            usdc.approve(address(escrow), type(uint256).max);
            usdc.approve(address(permit2), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(maker);
        id = escrow.create(SALT, DEPOSIT, deadline);
    }

    function _one(bytes32 c, address to, uint96 amount)
        internal
        pure
        returns (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts)
    {
        ids = new bytes32[](1);
        tos = new address[](1);
        amounts = new uint96[](1);
        (ids[0], tos[0], amounts[0]) = (c, to, amount);
    }

    function _release(address by, bytes32 c, address to, uint96 amount) internal {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) = _one(c, to, amount);
        vm.prank(by);
        escrow.release(id, ids, tos, amounts);
    }

    function _afterGrace() internal {
        vm.warp(uint256(deadline) + escrow.REFUND_GRACE() + 1);
    }

    // ------------------------------------------------------------ the full journey

    function test_journey_deposit_release_withdraw_refund() public {
        _release(releaser, C1, reviewerA, REVIEW);
        assertEq(usdc.balanceOf(reviewerA), 0, "release moves no token");
        assertEq(escrow.earned(reviewerA), REVIEW);

        escrow.withdraw(reviewerA);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(escrow.earned(reviewerA), 0);

        _afterGrace();
        vm.prank(attacker);
        escrow.close(id);
        vm.prank(attacker);
        escrow.claimRefund(id, maker);
        assertEq(usdc.balanceOf(maker), START - REVIEW, "maker gets back all but the review");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ------------------------------------------------------------ who may deposit

    function test_anyone_can_deposit_and_each_total_is_kept() public {
        vm.prank(friend);
        escrow.deposit(id, 100_000_000);
        vm.prank(admin);
        escrow.deposit(id, 50_000_000);
        assertEq(escrow.deposits(id, maker), DEPOSIT);
        assertEq(escrow.deposits(id, friend), 100_000_000);
        assertEq(escrow.deposits(id, admin), 50_000_000);
        assertEq(escrow.getCampaign(id).deposited, uint256(DEPOSIT) + 150_000_000);
        assertEq(escrow.getCampaign(id).creator, maker, "a deposit does not change the creator");
    }

    // ------------------------------------------------------------ who may release

    function test_releaser_and_admin_can_release() public {
        _release(releaser, C1, reviewerA, REVIEW);
        _release(admin, C2, reviewerB, REVIEW);
        assertEq(escrow.totalEarned(), 2 * uint256(REVIEW));
    }

    function test_maker_cannot_release_own_budget() public {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, maker, DEPOSIT);
        vm.prank(maker);
        vm.expectRevert(FavourReviewEscrow.NotReleaser.selector);
        escrow.release(id, ids, tos, amounts);
    }

    function testFuzz_stranger_can_never_release(address who) public {
        vm.assume(who != releaser && who != admin);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, who, REVIEW);
        vm.prank(who);
        vm.expectRevert(FavourReviewEscrow.NotReleaser.selector);
        escrow.release(id, ids, tos, amounts);
    }

    function test_old_releaser_loses_the_role() public {
        address next = makeAddr("next");
        vm.prank(admin);
        escrow.setReleaser(next);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerA, REVIEW);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.NotReleaser.selector);
        escrow.release(id, ids, tos, amounts);
        vm.prank(next);
        escrow.release(id, ids, tos, amounts);
    }

    // ------------------------------------------------------------ double release, budget

    function test_a_contribution_is_released_once() public {
        _release(releaser, C1, reviewerA, REVIEW);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerB, REVIEW);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.AlreadyReleased.selector);
        escrow.release(id, ids, tos, amounts);
    }

    function test_a_duplicate_inside_one_batch_reverts_whole() public {
        bytes32[] memory ids = new bytes32[](2);
        address[] memory tos = new address[](2);
        uint96[] memory amounts = new uint96[](2);
        (ids[0], ids[1]) = (C1, C1);
        (tos[0], tos[1]) = (reviewerA, reviewerB);
        (amounts[0], amounts[1]) = (REVIEW, REVIEW);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.AlreadyReleased.selector);
        escrow.release(id, ids, tos, amounts);
        assertEq(escrow.totalEarned(), 0);
        assertFalse(escrow.isReleased(id, C1));
    }

    function test_cannot_release_more_than_the_budget() public {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerA, DEPOSIT + 1);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.BudgetExceeded.selector);
        escrow.release(id, ids, tos, amounts);
        assertEq(escrow.earned(reviewerA), 0);
    }

    function test_one_campaign_cannot_spend_another() public {
        vm.prank(friend);
        bytes32 other = escrow.create(SALT, 1_000_000, deadline);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerA, 1_000_001);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.BudgetExceeded.selector);
        escrow.release(other, ids, tos, amounts);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT, "the first campaign is untouched");
    }

    function test_release_rejects_bad_items() public {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, address(0), REVIEW);
        vm.startPrank(releaser);
        vm.expectRevert(FavourReviewEscrow.InvalidRecipient.selector);
        escrow.release(id, ids, tos, amounts);
        tos[0] = address(escrow);
        vm.expectRevert(FavourReviewEscrow.InvalidRecipient.selector);
        escrow.release(id, ids, tos, amounts);
        tos[0] = reviewerA;
        amounts[0] = 0;
        vm.expectRevert(FavourReviewEscrow.ZeroAmount.selector);
        escrow.release(id, ids, tos, amounts);
        vm.expectRevert(FavourReviewEscrow.EmptyBatch.selector);
        escrow.release(id, new bytes32[](0), new address[](0), new uint96[](0));
        vm.expectRevert(FavourReviewEscrow.LengthMismatch.selector);
        escrow.release(id, ids, new address[](2), amounts);
        uint256 tooMany = escrow.MAX_BATCH() + 1;
        vm.expectRevert(FavourReviewEscrow.BatchTooLarge.selector);
        escrow.release(id, new bytes32[](tooMany), new address[](tooMany), new uint96[](tooMany));
        vm.stopPrank();
    }

    function test_no_release_after_close() public {
        _afterGrace();
        escrow.close(id);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerA, REVIEW);
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.CampaignNotOpen.selector);
        escrow.release(id, ids, tos, amounts);
    }

    // ------------------------------------------------------------ withdraw and fee

    function test_withdraw_goes_to_the_reviewer_whoever_calls() public {
        _release(releaser, C1, reviewerA, REVIEW);
        uint256 before = usdc.balanceOf(attacker);
        vm.prank(attacker);
        escrow.withdraw(reviewerA);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(attacker), before, "the caller gains nothing");
        vm.expectRevert(FavourReviewEscrow.NothingToWithdraw.selector);
        escrow.withdraw(reviewerA);
    }

    function test_fee_is_zero_at_start_and_never_on_deposit() public view {
        assertEq(escrow.feeBps(), 0);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT, "the whole deposit arrived");
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    function test_fee_is_taken_on_withdrawal_only() public {
        vm.prank(admin);
        escrow.setFee(250, treasury); // 2.5%
        _release(releaser, C1, reviewerA, REVIEW);
        escrow.withdraw(reviewerA);
        uint256 fee = uint256(REVIEW) * 250 / 10_000;
        assertEq(usdc.balanceOf(treasury), fee);
        assertEq(usdc.balanceOf(reviewerA), REVIEW - fee);
    }

    function test_fee_cannot_pass_the_cap_and_only_admin_sets_it() public {
        uint256 cap = escrow.MAX_FEE_BPS();
        vm.prank(admin);
        vm.expectRevert(FavourReviewEscrow.FeeTooHigh.selector);
        escrow.setFee(cap + 1, treasury);
        vm.prank(admin);
        vm.expectRevert(FavourReviewEscrow.ZeroAddress.selector);
        escrow.setFee(cap, address(0));
        vm.prank(releaser);
        vm.expectRevert(FavourReviewEscrow.NotAdmin.selector);
        escrow.setFee(1, treasury);
        vm.prank(admin);
        escrow.setFee(cap, treasury);
    }

    function testFuzz_fee_never_takes_more_than_the_cap(uint96 amount, uint256 bps) public {
        amount = uint96(bound(amount, 1, DEPOSIT));
        bps = bound(bps, 0, escrow.MAX_FEE_BPS());
        vm.prank(admin);
        escrow.setFee(bps, treasury);
        _release(releaser, C1, reviewerA, amount);
        escrow.withdraw(reviewerA);
        assertEq(usdc.balanceOf(reviewerA) + usdc.balanceOf(treasury), amount, "nothing is lost");
        assertLe(usdc.balanceOf(treasury) * 10_000, uint256(amount) * escrow.MAX_FEE_BPS());
    }

    // ------------------------------------------------------------ close

    function test_stranger_cannot_close_before_deadline_plus_grace() public {
        vm.prank(attacker);
        vm.expectRevert(FavourReviewEscrow.NotClosableYet.selector);
        escrow.close(id);
        vm.warp(uint256(deadline) + escrow.REFUND_GRACE());
        vm.prank(attacker);
        vm.expectRevert(FavourReviewEscrow.NotClosableYet.selector);
        escrow.close(id);
        vm.warp(uint256(deadline) + escrow.REFUND_GRACE() + 1);
        vm.prank(attacker);
        escrow.close(id);
    }

    function test_maker_can_claw_back_while_nothing_is_released() public {
        vm.prank(maker);
        escrow.close(id);
        escrow.claimRefund(id, maker);
        assertEq(usdc.balanceOf(maker), START);
    }

    function test_maker_cannot_claw_back_after_a_release() public {
        _release(releaser, C1, reviewerA, REVIEW);
        vm.prank(maker);
        vm.expectRevert(FavourReviewEscrow.NotClosableYet.selector);
        escrow.close(id);
    }

    function test_admin_can_close_at_any_time() public {
        _release(releaser, C1, reviewerA, REVIEW);
        vm.prank(admin);
        escrow.close(id);
        assertEq(escrow.getCampaign(id).refundable, DEPOSIT - REVIEW);
        escrow.withdraw(reviewerA); // earned money survives the close
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
    }

    function test_close_twice_reverts() public {
        vm.prank(admin);
        escrow.close(id);
        vm.prank(admin);
        vm.expectRevert(FavourReviewEscrow.CampaignNotOpen.selector);
        escrow.close(id);
    }

    // ------------------------------------------------------------ refund

    function test_refund_goes_to_each_depositor_in_proportion() public {
        vm.prank(admin);
        escrow.deposit(id, DEPOSIT); // admin funds half of the maker's campaign
        _release(releaser, C1, reviewerA, 100_000_000);
        _afterGrace();
        escrow.close(id);
        // 400 in, 100 released, 300 left: each put in half, each gets 150.
        assertEq(escrow.refundShare(id, maker), 150_000_000);
        assertEq(escrow.refundShare(id, admin), 150_000_000);
        escrow.claimRefund(id, maker);
        escrow.claimRefund(id, admin);
        assertEq(usdc.balanceOf(maker), START - DEPOSIT + 150_000_000);
        assertEq(usdc.balanceOf(admin), START - DEPOSIT + 150_000_000);
        assertEq(usdc.balanceOf(address(escrow)), 100_000_000, "only the reviewer's money is left");
    }

    function test_refund_is_claimed_once_and_only_after_close() public {
        vm.expectRevert(FavourReviewEscrow.CampaignNotClosed.selector);
        escrow.claimRefund(id, maker);
        vm.prank(admin);
        escrow.close(id);
        escrow.claimRefund(id, maker);
        vm.expectRevert(FavourReviewEscrow.RefundAlreadyClaimed.selector);
        escrow.claimRefund(id, maker);
    }

    function test_non_depositor_gets_no_refund() public {
        vm.prank(admin);
        escrow.close(id);
        vm.expectRevert(FavourReviewEscrow.NothingToRefund.selector);
        escrow.claimRefund(id, attacker);
    }

    function testFuzz_refunds_never_exceed_what_is_left(uint96 a, uint96 b, uint96 out) public {
        a = uint96(bound(a, 1, START));
        b = uint96(bound(b, 1, START));
        vm.prank(friend);
        escrow.deposit(id, a);
        vm.prank(admin);
        escrow.deposit(id, b);
        uint256 pool = uint256(DEPOSIT) + a + b;
        out = uint96(bound(out, 1, pool));
        _release(releaser, C1, reviewerA, out);
        vm.prank(admin);
        escrow.close(id);
        uint256 shares = escrow.refundShare(id, maker) + escrow.refundShare(id, friend)
            + escrow.refundShare(id, admin);
        assertLe(shares, pool - out, "shares never exceed the remainder");
        assertLe(pool - out - shares, 2, "at most one base unit lost per depositor but one");
        if (escrow.refundShare(id, maker) > 0) escrow.claimRefund(id, maker);
        if (escrow.refundShare(id, friend) > 0) escrow.claimRefund(id, friend);
        if (escrow.refundShare(id, admin) > 0) escrow.claimRefund(id, admin);
        escrow.withdraw(reviewerA);
        assertEq(usdc.balanceOf(address(escrow)), pool - out - shares, "only rounding dust stays");
    }

    // ------------------------------------------------------------ deposits

    function test_deposit_rules() public {
        vm.startPrank(friend);
        vm.expectRevert(FavourReviewEscrow.ZeroAmount.selector);
        escrow.deposit(id, 0);
        vm.expectRevert(FavourReviewEscrow.CampaignNotOpen.selector);
        escrow.deposit(keccak256("nope"), 1);
        vm.warp(deadline);
        vm.expectRevert(FavourReviewEscrow.CampaignEnded.selector);
        escrow.deposit(id, 1);
        vm.stopPrank();
    }

    function test_create_rules() public {
        vm.startPrank(maker);
        vm.expectRevert(FavourReviewEscrow.CampaignExists.selector);
        escrow.create(SALT, 1, deadline);
        vm.expectRevert(FavourReviewEscrow.ZeroAmount.selector);
        escrow.create(keccak256("b"), 0, deadline);
        vm.expectRevert(FavourReviewEscrow.DeadlineInvalid.selector);
        escrow.create(keccak256("b"), 1, uint64(block.timestamp));
        uint64 tooFar = uint64(block.timestamp + escrow.MAX_DURATION() + 1);
        vm.expectRevert(FavourReviewEscrow.DeadlineInvalid.selector);
        escrow.create(keccak256("b"), 1, tooFar);
        vm.stopPrank();
    }

    function test_permit2_paths_write_the_same_record() public {
        vm.startPrank(friend);
        permit2.approve(address(usdc), address(escrow), type(uint160).max, 0);
        bytes32 other = escrow.createWithPermit2(SALT, 10_000_000, deadline);
        permit2.approve(address(usdc), address(escrow), type(uint160).max, 0);
        escrow.depositWithPermit2(other, 5_000_000);
        vm.stopPrank();
        assertEq(escrow.getCampaign(other).remaining, 15_000_000);
        assertEq(escrow.deposits(other, friend), 15_000_000);
        assertEq(usdc.balanceOf(address(escrow)), uint256(DEPOSIT) + 15_000_000);
    }

    function test_attacker_cannot_deposit_with_makers_allowance() public {
        // The maker has an open allowance to the escrow. A deposit by the attacker
        // must pull from the attacker, never from the maker.
        uint256 makerBefore = usdc.balanceOf(maker);
        vm.prank(attacker);
        escrow.deposit(id, 1_000_000);
        assertEq(usdc.balanceOf(maker), makerBefore);
        assertEq(escrow.deposits(id, attacker), 1_000_000);
    }

    // ------------------------------------------------------------ roles

    function test_admin_changes_in_two_steps() public {
        address next = makeAddr("nextAdmin");
        vm.prank(attacker);
        vm.expectRevert(FavourReviewEscrow.NotAdmin.selector);
        escrow.proposeAdmin(attacker);
        vm.prank(admin);
        escrow.proposeAdmin(next);
        assertEq(escrow.admin(), admin, "nothing changes until the new admin accepts");
        vm.prank(attacker);
        vm.expectRevert(FavourReviewEscrow.NotPendingAdmin.selector);
        escrow.acceptAdmin();
        vm.prank(next);
        escrow.acceptAdmin();
        assertEq(escrow.admin(), next);
        vm.prank(admin);
        vm.expectRevert(FavourReviewEscrow.NotAdmin.selector);
        escrow.setReleaser(attacker);
    }

    function test_constructor_rejects_zero_addresses() public {
        IERC20 t = IERC20(address(usdc));
        IPermit2AllowanceTransfer p = IPermit2AllowanceTransfer(address(permit2));
        vm.expectRevert(FavourReviewEscrow.ZeroAddress.selector);
        new FavourReviewEscrow(IERC20(address(0)), p, admin, releaser);
        vm.expectRevert(FavourReviewEscrow.ZeroAddress.selector);
        new FavourReviewEscrow(t, p, address(0), releaser);
        vm.expectRevert(FavourReviewEscrow.ZeroAddress.selector);
        new FavourReviewEscrow(t, p, admin, address(0));
    }

    // ------------------------------------------------------------ what a stolen key can reach

    function test_a_stolen_releaser_cannot_touch_earned_or_refundable_money() public {
        _release(releaser, C1, reviewerA, REVIEW);
        vm.prank(friend);
        bytes32 closed = escrow.create(SALT, 50_000_000, deadline);
        vm.prank(admin);
        escrow.close(closed);
        // The thief drains the open budget to themselves.
        _release(releaser, C2, attacker, DEPOSIT - REVIEW);
        escrow.withdraw(attacker);
        // The reviewer's earned money and the closed campaign's refund are intact.
        escrow.withdraw(reviewerA);
        escrow.claimRefund(closed, friend);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(friend), START);
    }

    // ------------------------------------------------------------ reentrancy

    function test_reentrancy_through_the_token_is_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        FavourReviewEscrow e = new FavourReviewEscrow(
            IERC20(address(evil)), IPermit2AllowanceTransfer(address(permit2)), admin, releaser
        );
        evil.mint(maker, START);
        vm.startPrank(maker);
        evil.approve(address(e), type(uint256).max);
        bytes32 cid = e.create(SALT, DEPOSIT, deadline);
        vm.stopPrank();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amounts) =
            _one(C1, reviewerA, REVIEW);
        vm.prank(releaser);
        e.release(cid, ids, tos, amounts);
        // During the withdraw transfer the token calls withdraw again. The inner
        // call must revert; the mock reverts the outer call if it does not.
        evil.setAttack(
            IEscrowTarget(address(e)), abi.encodeCall(FavourReviewEscrow.withdraw, (reviewerA))
        );
        e.withdraw(reviewerA);
        assertEq(evil.balanceOf(reviewerA), REVIEW, "paid exactly once");
    }
}
