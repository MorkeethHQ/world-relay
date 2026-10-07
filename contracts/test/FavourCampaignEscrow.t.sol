// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, stdError} from "forge-std/Test.sol";
import {FavourCampaignEscrow, IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {ReentrantToken, IEscrowTarget} from "./mocks/ReentrantToken.sol";

/// @dev Unit and fuzz tests for FavourCampaignEscrow, grouped by failure class:
///      double payout, payout after refund, refund before the deadline, spending
///      past the budget, spending another campaign's budget, third-party allowance
///      spend, and reentrancy through the token. Time and size limits are always
///      read from the contract (MAX_DURATION, REFUND_GRACE, MAX_BATCH), never typed
///      in as numbers. All amounts are test fixtures, not real deposits.
contract FavourCampaignEscrowTest is Test {
    FavourCampaignEscrow internal escrow;
    MockUSDC internal usdc;
    MockPermit2 internal permit2;

    address internal maker = makeAddr("maker");
    address internal otherMaker = makeAddr("otherMaker");
    address internal reviewerA = makeAddr("reviewerA");
    address internal reviewerB = makeAddr("reviewerB");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant SALT = keccak256("campaign-1");
    bytes32 internal constant SALT_2 = keccak256("campaign-2");
    bytes32 internal constant CONTRIB_1 = keccak256("contribution-1");
    bytes32 internal constant CONTRIB_2 = keccak256("contribution-2");
    bytes32 internal constant CONTRIB_3 = keccak256("contribution-3");

    uint256 internal constant START_BALANCE = 1_000_000_000; // fixture: 1000 USDC
    uint96 internal constant DEPOSIT = 200_000_000; // fixture: 200 USDC scenario pool
    uint96 internal constant REVIEW = 5_000_000; // fixture: 5 USDC per review
    uint64 internal deadline;

    event Created(
        bytes32 indexed campaignId,
        address indexed funder,
        bytes32 salt,
        uint256 amount,
        uint64 deadline
    );
    event ToppedUp(
        bytes32 indexed campaignId, address indexed funder, uint256 amount, uint256 remaining
    );
    event Paid(
        bytes32 indexed campaignId,
        bytes32 indexed contributionId,
        address indexed recipient,
        uint256 amount
    );
    event Refunded(bytes32 indexed campaignId, address indexed funder, uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
        escrow = new FavourCampaignEscrow(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2))
        );
        deadline = uint64(block.timestamp + 14 days);

        address[2] memory makers = [maker, otherMaker];
        for (uint256 i = 0; i < makers.length; i++) {
            usdc.mint(makers[i], START_BALANCE);
            vm.startPrank(makers[i]);
            usdc.approve(address(escrow), type(uint256).max);
            // World App approves tokens to Permit2 at the token level. Mirror that.
            usdc.approve(address(permit2), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ---------------------------------------------------------------- helpers

    function _create() internal returns (bytes32 id) {
        vm.prank(maker);
        id = escrow.create(SALT, DEPOSIT, deadline);
    }

    function _createAs(address who, bytes32 salt, uint96 amount) internal returns (bytes32 id) {
        vm.prank(who);
        id = escrow.create(salt, amount, deadline);
    }

    function _one(bytes32 cid, address to, uint96 amount)
        internal
        pure
        returns (bytes32[] memory ids, address[] memory tos, uint96[] memory amts)
    {
        ids = new bytes32[](1);
        tos = new address[](1);
        amts = new uint96[](1);
        ids[0] = cid;
        tos[0] = to;
        amts[0] = amount;
    }

    function _two(bytes32 c1, address to1, uint96 a1, bytes32 c2, address to2, uint96 a2)
        internal
        pure
        returns (bytes32[] memory ids, address[] memory tos, uint96[] memory amts)
    {
        ids = new bytes32[](2);
        tos = new address[](2);
        amts = new uint96[](2);
        (ids[0], tos[0], amts[0]) = (c1, to1, a1);
        (ids[1], tos[1], amts[1]) = (c2, to2, a2);
    }

    function _pay(address who, bytes32 id, bytes32 cid, address to, uint96 amount) internal {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) = _one(cid, to, amount);
        vm.prank(who);
        escrow.payBatch(id, ids, tos, amts);
    }

    function _refundableAt() internal view returns (uint256) {
        return uint256(deadline) + escrow.REFUND_GRACE() + 1;
    }

    function _assertIdentity(bytes32 id) internal view {
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(
            uint256(c.deposited),
            uint256(c.paid) + uint256(c.refunded) + uint256(c.remaining),
            "deposited == paid + refunded + remaining"
        );
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_sets_immutables() public view {
        assertEq(address(escrow.USDC()), address(usdc));
        assertEq(address(escrow.PERMIT2()), address(permit2));
    }

    function test_constructor_rejects_zero_token() public {
        vm.expectRevert(FavourCampaignEscrow.ZeroAddress.selector);
        new FavourCampaignEscrow(IERC20(address(0)), IPermit2AllowanceTransfer(address(permit2)));
    }

    function test_constructor_rejects_zero_permit2() public {
        vm.expectRevert(FavourCampaignEscrow.ZeroAddress.selector);
        new FavourCampaignEscrow(IERC20(address(usdc)), IPermit2AllowanceTransfer(address(0)));
    }

    // ---------------------------------------------------------------- create

    function test_create_writes_full_record_and_pulls_exact_amount() public {
        bytes32 expectedId = escrow.campaignIdOf(maker, SALT);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Created(expectedId, maker, SALT, DEPOSIT, deadline);
        bytes32 id = _create();

        assertEq(id, expectedId);
        assertEq(id, keccak256(abi.encode(maker, SALT)));

        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.funder, maker);
        assertEq(c.deposited, DEPOSIT);
        assertEq(c.paid, 0);
        assertEq(c.refunded, 0);
        assertEq(c.remaining, DEPOSIT);
        assertEq(c.deadline, deadline);
        assertEq(uint8(c.status), uint8(FavourCampaignEscrow.Status.Active));

        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
        assertEq(usdc.balanceOf(maker), START_BALANCE - DEPOSIT);
    }

    function test_create_rejects_zero_amount() public {
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.ZeroAmount.selector);
        escrow.create(SALT, 0, deadline);
    }

    function test_create_rejects_past_and_present_deadline() public {
        vm.startPrank(maker);
        vm.expectRevert(FavourCampaignEscrow.DeadlineInvalid.selector);
        escrow.create(SALT, DEPOSIT, uint64(block.timestamp));
        vm.expectRevert(FavourCampaignEscrow.DeadlineInvalid.selector);
        escrow.create(SALT, DEPOSIT, uint64(block.timestamp - 1));
        vm.stopPrank();
    }

    function test_create_deadline_cap_is_max_duration() public {
        uint64 atCap = uint64(block.timestamp + escrow.MAX_DURATION());
        vm.startPrank(maker);
        vm.expectRevert(FavourCampaignEscrow.DeadlineInvalid.selector);
        escrow.create(SALT, DEPOSIT, atCap + 1);
        bytes32 id = escrow.create(SALT, DEPOSIT, atCap); // exactly at the cap is allowed
        vm.stopPrank();
        assertEq(escrow.getCampaign(id).deadline, atCap);
    }

    function test_create_same_salt_twice_reverts() public {
        _create();
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignExists.selector);
        escrow.create(SALT, DEPOSIT, deadline);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_campaign_id_cannot_be_reused_after_refund() public {
        bytes32 id = _create();
        vm.warp(_refundableAt());
        escrow.refund(id);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignExists.selector);
        escrow.create(SALT, DEPOSIT, uint64(block.timestamp + 1 days));
    }

    /// A stranger cannot take the id a maker's app already announced: the id is
    /// bound to the funder, so the same salt gives the stranger a different id.
    function test_stranger_cannot_squat_makers_campaign_id() public {
        usdc.mint(attacker, 1);
        vm.startPrank(attacker);
        usdc.approve(address(escrow), type(uint256).max);
        bytes32 squat = escrow.create(SALT, 1, deadline);
        vm.stopPrank();

        bytes32 id = _create(); // the maker's create still works
        assertTrue(squat != id);
        assertEq(escrow.getCampaign(id).funder, maker);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
        assertEq(escrow.getCampaign(squat).funder, attacker);
    }

    // ---------------------------------------------------------------- third-party allowance

    /// The maker has an unlimited approval to the escrow. An attacker calling create
    /// can only ever be charged from the attacker's own balance.
    function test_attacker_cannot_spend_makers_token_approval() public {
        vm.prank(attacker);
        vm.expectRevert(); // attacker has no USDC and no allowance
        escrow.create(SALT, DEPOSIT, deadline);
        assertEq(usdc.balanceOf(maker), START_BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_attacker_cannot_spend_makers_permit2_allowance() public {
        vm.prank(maker);
        permit2.approve(address(usdc), address(escrow), DEPOSIT, 0);

        vm.prank(attacker);
        vm.expectRevert(); // Permit2 looks up the allowance of msg.sender, the attacker
        escrow.createWithPermit2(SALT, DEPOSIT, deadline);
        assertEq(usdc.balanceOf(maker), START_BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_attacker_cannot_top_up_with_makers_allowance() public {
        bytes32 id = _create();
        vm.prank(attacker);
        vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
        escrow.topUp(id, REVIEW);
        vm.prank(attacker);
        vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
        escrow.topUpWithPermit2(id, REVIEW);
        assertEq(usdc.balanceOf(maker), START_BALANCE - DEPOSIT);
    }

    // ---------------------------------------------------------------- Permit2 fund path

    function test_p2_create_and_plain_create_write_the_same_record() public {
        bytes32 plain = _create();

        vm.startPrank(maker);
        permit2.approve(address(usdc), address(escrow), DEPOSIT, 0);
        bytes32 viaP2 = escrow.createWithPermit2(SALT_2, DEPOSIT, deadline);
        vm.stopPrank();

        assertEq(viaP2, escrow.campaignIdOf(maker, SALT_2));
        FavourCampaignEscrow.Campaign memory a = escrow.getCampaign(plain);
        FavourCampaignEscrow.Campaign memory b = escrow.getCampaign(viaP2);
        assertEq(a.funder, b.funder);
        assertEq(a.deposited, b.deposited);
        assertEq(a.paid, b.paid);
        assertEq(a.refunded, b.refunded);
        assertEq(a.remaining, b.remaining);
        assertEq(a.deadline, b.deadline);
        assertEq(uint8(a.status), uint8(b.status));
        assertEq(b.funder, maker);
        assertEq(b.remaining, DEPOSIT);

        assertEq(usdc.balanceOf(address(escrow)), uint256(DEPOSIT) * 2);
        assertEq(usdc.balanceOf(maker), START_BALANCE - uint256(DEPOSIT) * 2);
    }

    function test_p2_top_up_and_plain_top_up_write_the_same_record() public {
        bytes32 plain = _create();
        bytes32 viaP2 = _createAs(maker, SALT_2, DEPOSIT);

        vm.startPrank(maker);
        escrow.topUp(plain, REVIEW);
        permit2.approve(address(usdc), address(escrow), REVIEW, 0);
        escrow.topUpWithPermit2(viaP2, REVIEW);
        vm.stopPrank();

        FavourCampaignEscrow.Campaign memory a = escrow.getCampaign(plain);
        FavourCampaignEscrow.Campaign memory b = escrow.getCampaign(viaP2);
        assertEq(a.deposited, DEPOSIT + REVIEW);
        assertEq(a.remaining, DEPOSIT + REVIEW);
        assertEq(b.deposited, a.deposited);
        assertEq(b.remaining, a.remaining);
        assertEq(b.deadline, a.deadline);
        assertEq(usdc.balanceOf(address(escrow)), (uint256(DEPOSIT) + REVIEW) * 2);
    }

    function test_p2_create_without_allowance_reverts() public {
        vm.prank(maker);
        vm.expectRevert();
        escrow.createWithPermit2(SALT, DEPOSIT, deadline);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(
            uint8(escrow.getCampaign(escrow.campaignIdOf(maker, SALT)).status),
            uint8(FavourCampaignEscrow.Status.None)
        );
    }

    function test_p2_allowance_smaller_than_amount_reverts() public {
        vm.startPrank(maker);
        permit2.approve(address(usdc), address(escrow), DEPOSIT - 1, 0);
        vm.expectRevert();
        escrow.createWithPermit2(SALT, DEPOSIT, deadline);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_p2_expired_allowance_reverts() public {
        vm.prank(maker);
        permit2.approve(address(usdc), address(escrow), DEPOSIT, 0); // this block only
        vm.warp(block.timestamp + 1);
        vm.prank(maker);
        vm.expectRevert();
        escrow.createWithPermit2(SALT, DEPOSIT, deadline);
    }

    function test_p2_allowance_for_another_spender_is_unusable() public {
        vm.startPrank(maker);
        permit2.approve(address(usdc), attacker, DEPOSIT, 0);
        vm.expectRevert();
        escrow.createWithPermit2(SALT, DEPOSIT, deadline);
        vm.stopPrank();
    }

    function test_p2_allowance_cannot_be_replayed() public {
        vm.startPrank(maker);
        permit2.approve(address(usdc), address(escrow), DEPOSIT, 0);
        bytes32 id = escrow.createWithPermit2(SALT, DEPOSIT, deadline);
        vm.expectRevert(); // the allowance was used up by the create
        escrow.topUpWithPermit2(id, 1);
        vm.stopPrank();
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    // ---------------------------------------------------------------- top up

    function test_top_up_adds_budget_and_keeps_deadline() public {
        bytes32 id = _create();
        vm.expectEmit(true, true, true, true, address(escrow));
        emit ToppedUp(id, maker, REVIEW, uint256(DEPOSIT) + REVIEW);
        vm.prank(maker);
        escrow.topUp(id, REVIEW);

        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.deposited, DEPOSIT + REVIEW);
        assertEq(c.remaining, DEPOSIT + REVIEW);
        assertEq(c.deadline, deadline);
        assertEq(usdc.balanceOf(address(escrow)), uint256(DEPOSIT) + REVIEW);
        _assertIdentity(id);
    }

    function test_top_up_after_partial_spend_keeps_identity() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        vm.prank(maker);
        escrow.topUp(id, REVIEW * 3);

        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.deposited, DEPOSIT + REVIEW * 3);
        assertEq(c.paid, REVIEW);
        assertEq(c.remaining, DEPOSIT + REVIEW * 2);
        _assertIdentity(id);
    }

    function test_top_up_only_funder() public {
        bytes32 id = _create();
        vm.prank(otherMaker); // has balance and approval, still not the funder
        vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
        escrow.topUp(id, REVIEW);
        assertEq(usdc.balanceOf(otherMaker), START_BALANCE);
    }

    function test_top_up_unknown_campaign_reverts() public {
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.topUp(keccak256("nope"), REVIEW);
    }

    function test_top_up_rejects_zero_amount() public {
        bytes32 id = _create();
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.ZeroAmount.selector);
        escrow.topUp(id, 0);
    }

    function test_top_up_blocked_at_deadline_allowed_one_second_before() public {
        bytes32 id = _create();
        vm.warp(deadline - 1);
        vm.prank(maker);
        escrow.topUp(id, REVIEW);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT + REVIEW);

        vm.warp(deadline);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignEnded.selector);
        escrow.topUp(id, REVIEW);
        vm.startPrank(maker);
        permit2.approve(address(usdc), address(escrow), REVIEW, 0);
        vm.expectRevert(FavourCampaignEscrow.CampaignEnded.selector);
        escrow.topUpWithPermit2(id, REVIEW);
        vm.stopPrank();
    }

    function test_top_up_after_refund_reverts_on_both_paths() public {
        bytes32 id = _create();
        vm.warp(_refundableAt());
        escrow.refund(id);
        uint256 makerBefore = usdc.balanceOf(maker);

        vm.startPrank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.topUp(id, REVIEW);
        permit2.approve(address(usdc), address(escrow), REVIEW, 0);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.topUpWithPermit2(id, REVIEW);
        vm.stopPrank();

        assertEq(usdc.balanceOf(maker), makerBefore);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_top_up_past_uint96_reverts() public {
        uint96 max = type(uint96).max;
        usdc.mint(maker, uint256(max));
        vm.startPrank(maker);
        bytes32 id = escrow.create(SALT, max, deadline);
        vm.expectRevert(stdError.arithmeticError);
        escrow.topUp(id, 1);
        vm.stopPrank();
        assertEq(escrow.getCampaign(id).deposited, max);
    }

    // ---------------------------------------------------------------- payBatch

    function test_pay_single_item() public {
        bytes32 id = _create();
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Paid(id, CONTRIB_1, reviewerA, REVIEW);
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);

        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT - REVIEW);
        assertTrue(escrow.isPaid(id, CONTRIB_1));
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.paid, REVIEW);
        assertEq(c.remaining, DEPOSIT - REVIEW);
        _assertIdentity(id);
    }

    function test_pay_batch_emits_one_event_per_item_and_pays_each() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_2, reviewerB, REVIEW * 2);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit Paid(id, CONTRIB_1, reviewerA, REVIEW);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Paid(id, CONTRIB_2, reviewerB, REVIEW * 2);
        vm.prank(maker);
        escrow.payBatch(id, ids, tos, amts);

        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(reviewerB), REVIEW * 2);
        assertTrue(escrow.isPaid(id, CONTRIB_1));
        assertTrue(escrow.isPaid(id, CONTRIB_2));
        assertFalse(escrow.isPaid(id, CONTRIB_3));
        assertEq(escrow.getCampaign(id).paid, REVIEW * 3);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT - REVIEW * 3);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT - REVIEW * 3);
    }

    /// 1000 base units is 0.001000 USDC. No rounding anywhere.
    function test_pay_exact_1000_units() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, 1000);
        assertEq(usdc.balanceOf(reviewerA), 1000);
        assertEq(escrow.getCampaign(id).paid, 1000);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT - 1000);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT - 1000);
    }

    function test_pay_only_funder() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, attacker, DEPOSIT);

        address[3] memory callers = [attacker, otherMaker, reviewerA];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
            escrow.payBatch(id, ids, tos, amts);
        }
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    function test_pay_unknown_campaign_reverts() public {
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, reviewerA, REVIEW);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.payBatch(keccak256("nope"), ids, tos, amts);
    }

    function test_pay_empty_batch_reverts() public {
        bytes32 id = _create();
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.EmptyBatch.selector);
        escrow.payBatch(id, new bytes32[](0), new address[](0), new uint96[](0));
    }

    function _batchOf(uint256 n, uint96 each)
        internal
        view
        returns (bytes32[] memory ids, address[] memory tos, uint96[] memory amts)
    {
        ids = new bytes32[](n);
        tos = new address[](n);
        amts = new uint96[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = keccak256(abi.encode("bulk", i));
            tos[i] = reviewerA;
            amts[i] = each;
        }
    }

    function test_pay_batch_size_cap_is_max_batch() public {
        bytes32 id = _create();
        uint256 cap = escrow.MAX_BATCH();

        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) = _batchOf(cap + 1, 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.BatchTooLarge.selector);
        escrow.payBatch(id, ids, tos, amts);

        (ids, tos, amts) = _batchOf(cap, 1); // exactly at the cap is allowed
        vm.prank(maker);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(usdc.balanceOf(reviewerA), cap);
        assertEq(escrow.getCampaign(id).paid, cap);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT - cap);
    }

    function test_pay_length_mismatch_reverts() public {
        bytes32 id = _create();
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = CONTRIB_1;
        ids[1] = CONTRIB_2;
        address[] memory tos2 = new address[](2);
        tos2[0] = reviewerA;
        tos2[1] = reviewerB;
        uint96[] memory amts2 = new uint96[](2);
        amts2[0] = REVIEW;
        amts2[1] = REVIEW;

        address[] memory tos1 = new address[](1);
        tos1[0] = reviewerA;
        uint96[] memory amts3 = new uint96[](3);
        amts3[0] = REVIEW;
        amts3[1] = REVIEW;
        amts3[2] = REVIEW;

        vm.startPrank(maker);
        vm.expectRevert(FavourCampaignEscrow.LengthMismatch.selector);
        escrow.payBatch(id, ids, tos1, amts2);
        vm.expectRevert(FavourCampaignEscrow.LengthMismatch.selector);
        escrow.payBatch(id, ids, tos2, amts3);
        vm.stopPrank();
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    function test_pay_rejects_zero_recipient_and_the_escrow_itself() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_2, address(0), REVIEW);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.InvalidRecipient.selector);
        escrow.payBatch(id, ids, tos, amts);

        tos[1] = address(escrow);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.InvalidRecipient.selector);
        escrow.payBatch(id, ids, tos, amts);

        // The first item was valid, and it still did not go through.
        assertFalse(escrow.isPaid(id, CONTRIB_1));
        assertEq(usdc.balanceOf(reviewerA), 0);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    function test_pay_rejects_zero_amount() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_2, reviewerB, 0);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.ZeroAmount.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertFalse(escrow.isPaid(id, CONTRIB_1));
        assertEq(usdc.balanceOf(reviewerA), 0);
    }

    // ---------------------------------------------------------------- CLASS: budget is a hard cap

    function test_pay_one_unit_over_budget_reverts_exact_budget_passes() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, DEPOSIT - REVIEW, CONTRIB_2, reviewerB, REVIEW + 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
        assertEq(usdc.balanceOf(reviewerA), 0);

        amts[1] = REVIEW; // the sum is now exactly the budget
        vm.prank(maker);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(escrow.getCampaign(id).remaining, 0);
        assertEq(escrow.getCampaign(id).paid, DEPOSIT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertIdentity(id);
    }

    function test_spent_campaign_cannot_pay_one_more_unit() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, DEPOSIT);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_2, reviewerB, 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
        escrow.payBatch(id, ids, tos, amts);
    }

    /// The uint256 sum cannot overflow: MAX_BATCH items of the largest uint96 each
    /// still fit, so an absurd batch fails on the budget check and not on a wrap.
    function test_pay_sum_cannot_overflow() public {
        uint256 cap = escrow.MAX_BATCH();
        assertLe(cap, type(uint256).max / type(uint96).max);

        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _batchOf(cap, type(uint96).max);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
        assertEq(usdc.balanceOf(reviewerA), 0);
    }

    // ---------------------------------------------------------------- CLASS: cross-campaign spend

    function test_campaign_cannot_spend_another_campaigns_money() public {
        bytes32 a = _create(); // maker, DEPOSIT
        bytes32 b = _createAs(otherMaker, SALT, REVIEW); // otherMaker, small
        assertEq(usdc.balanceOf(address(escrow)), uint256(DEPOSIT) + REVIEW);

        // The contract holds enough USDC for this payout, but campaign b does not.
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, otherMaker, REVIEW + 1);
        vm.prank(otherMaker);
        vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
        escrow.payBatch(b, ids, tos, amts);

        // otherMaker cannot pay out of campaign a either.
        vm.prank(otherMaker);
        vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
        escrow.payBatch(a, ids, tos, amts);

        // b spends all of b. a is untouched and still fully backed.
        _pay(otherMaker, b, CONTRIB_1, reviewerB, REVIEW);
        assertEq(escrow.getCampaign(b).remaining, 0);
        assertEq(escrow.getCampaign(a).remaining, DEPOSIT);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);

        // b's refund cannot take a's money.
        vm.warp(_refundableAt());
        vm.expectRevert(FavourCampaignEscrow.NothingToRefund.selector);
        escrow.refund(b);
        escrow.refund(a);
        assertEq(usdc.balanceOf(maker), START_BALANCE);
        assertEq(usdc.balanceOf(otherMaker), START_BALANCE - REVIEW);
    }

    // ---------------------------------------------------------------- CLASS: double payout

    function test_duplicate_contribution_inside_one_batch_reverts() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_1, reviewerA, REVIEW);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.ContributionAlreadyPaid.selector);
        escrow.payBatch(id, ids, tos, amts);

        assertFalse(escrow.isPaid(id, CONTRIB_1));
        assertEq(usdc.balanceOf(reviewerA), 0);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
    }

    function test_batch_replay_reverts() public {
        bytes32 id = _create();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_2, reviewerB, REVIEW);
        vm.startPrank(maker);
        escrow.payBatch(id, ids, tos, amts);
        vm.expectRevert(FavourCampaignEscrow.ContributionAlreadyPaid.selector);
        escrow.payBatch(id, ids, tos, amts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(reviewerB), REVIEW);
        assertEq(escrow.getCampaign(id).paid, REVIEW * 2);
    }

    function test_paid_contribution_cannot_be_paid_again_to_someone_else() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_2, reviewerB, REVIEW, CONTRIB_1, reviewerB, 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.ContributionAlreadyPaid.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertFalse(escrow.isPaid(id, CONTRIB_2)); // the fresh item rolled back with it
        assertEq(usdc.balanceOf(reviewerB), 0);
    }

    /// Contribution ids are scoped per campaign. An attacker who pays the same
    /// contribution id with dust in a throwaway campaign does not block the maker.
    function test_dust_campaign_cannot_block_a_contribution_id() public {
        bytes32 id = _create();

        usdc.mint(attacker, 1);
        vm.startPrank(attacker);
        usdc.approve(address(escrow), type(uint256).max);
        bytes32 throwaway = escrow.create(SALT, 1, deadline);
        vm.stopPrank();
        _pay(attacker, throwaway, CONTRIB_1, attacker, 1);
        assertTrue(escrow.isPaid(throwaway, CONTRIB_1));
        assertFalse(escrow.isPaid(id, CONTRIB_1));

        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW); // the real payout still works
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertTrue(escrow.isPaid(id, CONTRIB_1));
    }

    // ---------------------------------------------------------------- timing

    function test_pay_works_after_deadline_and_after_grace_until_refund() public {
        bytes32 id = _create();
        vm.warp(uint256(deadline) + 1);
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        vm.warp(_refundableAt() + 30 days);
        _pay(maker, id, CONTRIB_2, reviewerB, REVIEW);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(usdc.balanceOf(reviewerB), REVIEW);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT - REVIEW * 2);
    }

    // ---------------------------------------------------------------- CLASS: payout after refund

    function test_pay_after_refund_reverts() public {
        bytes32 id = _create();
        vm.warp(_refundableAt());
        escrow.refund(id);

        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, reviewerA, 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(usdc.balanceOf(reviewerA), 0);
    }

    /// Another campaign's money is in the contract while a refunded one tries to pay.
    function test_refunded_campaign_cannot_pay_from_other_campaigns_balance() public {
        bytes32 a = _create();
        bytes32 b = _createAs(otherMaker, SALT, DEPOSIT);
        vm.warp(_refundableAt());
        escrow.refund(a);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);

        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, maker, DEPOSIT);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.payBatch(a, ids, tos, amts);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.refund(a);
        assertEq(escrow.getCampaign(b).remaining, DEPOSIT);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
    }

    // ---------------------------------------------------------------- CLASS: refund timing and destination

    function test_refund_blocked_before_and_at_deadline() public {
        bytes32 id = _create();
        vm.expectRevert(FavourCampaignEscrow.NotRefundableYet.selector);
        escrow.refund(id);
        vm.warp(deadline);
        vm.expectRevert(FavourCampaignEscrow.NotRefundableYet.selector);
        escrow.refund(id);
        vm.warp(uint256(deadline) + 1);
        vm.prank(maker); // the funder cannot pull early either
        vm.expectRevert(FavourCampaignEscrow.NotRefundableYet.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_refund_blocked_at_exactly_deadline_plus_grace() public {
        bytes32 id = _create();
        vm.warp(uint256(deadline) + escrow.REFUND_GRACE());
        vm.expectRevert(FavourCampaignEscrow.NotRefundableYet.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
    }

    function test_refund_allowed_one_second_after_deadline_plus_grace() public {
        bytes32 id = _create();
        vm.warp(uint256(deadline) + escrow.REFUND_GRACE() + 1);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Refunded(id, maker, DEPOSIT);
        escrow.refund(id);

        assertEq(usdc.balanceOf(maker), START_BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.remaining, 0);
        assertEq(c.refunded, DEPOSIT);
        assertEq(c.paid, 0);
        assertEq(c.deposited, DEPOSIT);
        assertEq(uint8(c.status), uint8(FavourCampaignEscrow.Status.Refunded));
        _assertIdentity(id);
    }

    function test_refund_called_by_stranger_lands_on_funder_only() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        vm.warp(_refundableAt());

        vm.prank(attacker);
        escrow.refund(id);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(maker), START_BALANCE - REVIEW);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);
        assertEq(escrow.getCampaign(id).refunded, DEPOSIT - REVIEW);
        assertEq(escrow.getCampaign(id).paid, REVIEW);
        _assertIdentity(id);
    }

    function test_double_refund_reverts() public {
        bytes32 id = _create();
        vm.warp(_refundableAt());
        escrow.refund(id);
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.refund(id);
        assertEq(usdc.balanceOf(maker), START_BALANCE);
    }

    function test_refund_with_nothing_left_reverts() public {
        bytes32 id = _create();
        _pay(maker, id, CONTRIB_1, reviewerA, DEPOSIT);
        vm.warp(_refundableAt());
        vm.expectRevert(FavourCampaignEscrow.NothingToRefund.selector);
        escrow.refund(id);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(FavourCampaignEscrow.Status.Active));
    }

    function test_refund_unknown_campaign_reverts() public {
        vm.warp(_refundableAt());
        vm.expectRevert(FavourCampaignEscrow.CampaignNotActive.selector);
        escrow.refund(keccak256("nope"));
    }

    function test_refund_never_callable_up_to_grace_end_fuzz(uint64 warpTo) public {
        bytes32 id = _create();
        warpTo = uint64(bound(warpTo, block.timestamp, uint256(deadline) + escrow.REFUND_GRACE()));
        vm.warp(warpTo);
        vm.expectRevert(FavourCampaignEscrow.NotRefundableYet.selector);
        escrow.refund(id);
    }

    // ---------------------------------------------------------------- blocklist

    function test_blocklisted_recipient_reverts_whole_batch_refund_still_open() public {
        bytes32 id = _create();
        usdc.setBlocklisted(reviewerB, true);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _two(CONTRIB_1, reviewerA, REVIEW, CONTRIB_2, reviewerB, REVIEW);
        vm.prank(maker);
        vm.expectRevert(bytes("USDC: recipient blocklisted"));
        escrow.payBatch(id, ids, tos, amts);

        // Nothing moved and nothing is marked paid.
        assertFalse(escrow.isPaid(id, CONTRIB_1));
        assertFalse(escrow.isPaid(id, CONTRIB_2));
        assertEq(usdc.balanceOf(reviewerA), 0);
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
        assertEq(escrow.getCampaign(id).paid, 0);

        // The funder sends the batch again without the blocked recipient.
        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);

        // The remainder still goes home after the grace period.
        vm.warp(_refundableAt());
        escrow.refund(id);
        assertEq(usdc.balanceOf(maker), START_BALANCE - REVIEW);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_blocklisted_funder_refund_reverts_but_payouts_still_work() public {
        bytes32 id = _create();
        usdc.setBlocklisted(maker, true);
        vm.warp(_refundableAt());
        vm.expectRevert(bytes("USDC: recipient blocklisted"));
        escrow.refund(id);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(FavourCampaignEscrow.Status.Active));
        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);

        _pay(maker, id, CONTRIB_1, reviewerA, REVIEW);
        assertEq(usdc.balanceOf(reviewerA), REVIEW);

        usdc.setBlocklisted(maker, false);
        escrow.refund(id);
        assertEq(usdc.balanceOf(maker), START_BALANCE - REVIEW);
    }

    // ---------------------------------------------------------------- stranded USDC

    function test_usdc_sent_directly_is_stranded_and_changes_no_record() public {
        bytes32 id = _create();
        uint256 donation = 7_000_000;
        usdc.mint(attacker, donation);
        vm.prank(attacker);
        assertTrue(usdc.transfer(address(escrow), donation));

        assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, reviewerA, DEPOSIT + 1);
        vm.prank(maker);
        vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
        escrow.payBatch(id, ids, tos, amts);

        vm.warp(_refundableAt());
        escrow.refund(id);
        assertEq(usdc.balanceOf(maker), START_BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), donation);
    }

    // ---------------------------------------------------------------- CLASS: reentrancy through the token

    /// The hostile token is itself the funder here. That is the strongest attacker:
    /// its reentrant call passes the funder check, so only the reentrancy guard
    /// stands between it and a second action. ReentrantToken reverts the outer
    /// transfer with "reentrancy succeeded" if the inner call goes through, so a
    /// passing outer call proves the inner call was blocked.
    function _evilSetup()
        internal
        returns (ReentrantToken evil, FavourCampaignEscrow esc2, bytes32 id)
    {
        evil = new ReentrantToken();
        esc2 = new FavourCampaignEscrow(
            IERC20(address(evil)), IPermit2AllowanceTransfer(address(permit2))
        );
        evil.mint(address(evil), START_BALANCE);
        vm.startPrank(address(evil));
        evil.approve(address(esc2), type(uint256).max);
        id = esc2.create(SALT, DEPOSIT, deadline);
        vm.stopPrank();
    }

    function test_reentrancy_create_into_create_blocked() public {
        (ReentrantToken evil, FavourCampaignEscrow esc2,) = _evilSetup();
        evil.setAttack(
            IEscrowTarget(address(esc2)),
            abi.encodeCall(FavourCampaignEscrow.create, (SALT_2, DEPOSIT, deadline))
        );
        vm.prank(address(evil));
        bytes32 third = esc2.create(keccak256("campaign-3"), DEPOSIT, deadline);

        assertEq(esc2.getCampaign(third).remaining, DEPOSIT);
        assertEq(
            uint8(esc2.getCampaign(esc2.campaignIdOf(address(evil), SALT_2)).status),
            uint8(FavourCampaignEscrow.Status.None)
        );
        assertEq(evil.balanceOf(address(esc2)), uint256(DEPOSIT) * 2);
    }

    function test_reentrancy_top_up_into_top_up_blocked() public {
        (ReentrantToken evil, FavourCampaignEscrow esc2, bytes32 id) = _evilSetup();
        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourCampaignEscrow.topUp, (id, REVIEW))
        );
        vm.prank(address(evil));
        esc2.topUp(id, REVIEW);
        assertEq(esc2.getCampaign(id).deposited, DEPOSIT + REVIEW);
        assertEq(esc2.getCampaign(id).remaining, DEPOSIT + REVIEW);
        assertEq(evil.balanceOf(address(esc2)), uint256(DEPOSIT) + REVIEW);
    }

    function test_reentrancy_pay_into_pay_blocked() public {
        (ReentrantToken evil, FavourCampaignEscrow esc2, bytes32 id) = _evilSetup();
        (bytes32[] memory ids2, address[] memory tos2, uint96[] memory amts2) =
            _one(CONTRIB_2, attacker, REVIEW);
        evil.setAttack(
            IEscrowTarget(address(esc2)),
            abi.encodeCall(FavourCampaignEscrow.payBatch, (id, ids2, tos2, amts2))
        );

        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, reviewerA, REVIEW);
        vm.prank(address(evil));
        esc2.payBatch(id, ids, tos, amts);

        assertEq(evil.balanceOf(reviewerA), REVIEW);
        assertEq(evil.balanceOf(attacker), 0);
        assertTrue(esc2.isPaid(id, CONTRIB_1));
        assertFalse(esc2.isPaid(id, CONTRIB_2));
        assertEq(esc2.getCampaign(id).remaining, DEPOSIT - REVIEW);
    }

    function test_reentrancy_pay_into_refund_blocked() public {
        (ReentrantToken evil, FavourCampaignEscrow esc2, bytes32 id) = _evilSetup();
        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourCampaignEscrow.refund, (id))
        );
        vm.warp(uint256(deadline) + esc2.REFUND_GRACE() + 1); // refund is otherwise open

        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, reviewerA, REVIEW);
        vm.prank(address(evil));
        esc2.payBatch(id, ids, tos, amts);

        assertEq(evil.balanceOf(reviewerA), REVIEW);
        assertEq(uint8(esc2.getCampaign(id).status), uint8(FavourCampaignEscrow.Status.Active));
        assertEq(esc2.getCampaign(id).remaining, DEPOSIT - REVIEW);
        assertEq(esc2.getCampaign(id).refunded, 0);
        assertEq(evil.balanceOf(address(esc2)), DEPOSIT - REVIEW);
    }

    function test_reentrancy_refund_into_pay_and_refund_blocked() public {
        (ReentrantToken evil, FavourCampaignEscrow esc2, bytes32 id) = _evilSetup();
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, attacker, REVIEW);
        evil.setAttack(
            IEscrowTarget(address(esc2)),
            abi.encodeCall(FavourCampaignEscrow.payBatch, (id, ids, tos, amts))
        );
        vm.warp(uint256(deadline) + esc2.REFUND_GRACE() + 1);
        esc2.refund(id);

        assertEq(evil.balanceOf(address(evil)), START_BALANCE);
        assertEq(evil.balanceOf(attacker), 0);
        assertEq(evil.balanceOf(address(esc2)), 0);
        assertEq(esc2.getCampaign(id).refunded, DEPOSIT);

        // A second campaign, refund re-entering refund.
        vm.prank(address(evil));
        bytes32 id2 = esc2.create(SALT_2, DEPOSIT, uint64(block.timestamp + 1 days));
        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourCampaignEscrow.refund, (id2))
        );
        vm.warp(block.timestamp + 1 days + esc2.REFUND_GRACE() + 1);
        esc2.refund(id2);
        assertEq(evil.balanceOf(address(evil)), START_BALANCE);
        assertEq(esc2.getCampaign(id2).refunded, DEPOSIT);
    }

    // ---------------------------------------------------------------- fuzz

    /// Any create, top up, batch and refund sequence keeps the accounting identity,
    /// and every unit ends up with a reviewer or back with the funder.
    function test_lifecycle_accounting_fuzz(
        uint96 deposit,
        uint96 topUpAmount,
        uint96 payA,
        uint96 payB,
        uint64 duration,
        bool viaPermit2
    ) public {
        deposit = uint96(bound(deposit, 1, START_BALANCE / 2));
        topUpAmount = uint96(bound(topUpAmount, 1, START_BALANCE / 2));
        duration = uint64(bound(duration, 2, escrow.MAX_DURATION()));
        uint256 budget = uint256(deposit) + topUpAmount;
        payA = uint96(bound(payA, 1, budget));
        payB = uint96(bound(payB, 0, budget - payA));
        uint64 dl = uint64(block.timestamp) + duration;

        vm.startPrank(maker);
        bytes32 id;
        if (viaPermit2) {
            permit2.approve(address(usdc), address(escrow), deposit, 0);
            id = escrow.createWithPermit2(SALT, deposit, dl);
            permit2.approve(address(usdc), address(escrow), topUpAmount, 0);
            escrow.topUpWithPermit2(id, topUpAmount);
        } else {
            id = escrow.create(SALT, deposit, dl);
            escrow.topUp(id, topUpAmount);
        }
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(escrow)), budget);
        _assertIdentity(id);

        _pay(maker, id, CONTRIB_1, reviewerA, payA);
        if (payB > 0) _pay(maker, id, CONTRIB_2, reviewerB, payB);
        _assertIdentity(id);

        uint256 left = budget - payA - payB;
        assertEq(escrow.getCampaign(id).remaining, left);
        assertEq(usdc.balanceOf(address(escrow)), left);

        vm.warp(uint256(dl) + escrow.REFUND_GRACE() + 1);
        if (left == 0) {
            vm.expectRevert(FavourCampaignEscrow.NothingToRefund.selector);
            escrow.refund(id);
        } else {
            escrow.refund(id);
            assertEq(escrow.getCampaign(id).refunded, left);
        }

        _assertIdentity(id);
        assertEq(usdc.balanceOf(reviewerA), payA);
        assertEq(usdc.balanceOf(reviewerB), payB);
        assertEq(usdc.balanceOf(maker), START_BALANCE - payA - payB);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// A batch either pays every item exactly or changes nothing at all.
    function test_batch_is_all_or_nothing_fuzz(uint96[8] memory raw, uint8 lenSeed) public {
        bytes32 id = _create();
        uint256 n = bound(lenSeed, 1, raw.length);
        bytes32[] memory ids = new bytes32[](n);
        address[] memory tos = new address[](n);
        uint96[] memory amts = new uint96[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            ids[i] = keccak256(abi.encode("fuzz", i));
            tos[i] = vm.addr(0xBEEF00 + i);
            amts[i] = uint96(bound(raw[i], 1, uint256(DEPOSIT) / 4));
            total += amts[i];
        }

        vm.prank(maker);
        if (total > DEPOSIT) {
            vm.expectRevert(FavourCampaignEscrow.BudgetExceeded.selector);
            escrow.payBatch(id, ids, tos, amts);
            assertEq(escrow.getCampaign(id).remaining, DEPOSIT);
            assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
            for (uint256 i = 0; i < n; i++) {
                assertFalse(escrow.isPaid(id, ids[i]));
            }
        } else {
            escrow.payBatch(id, ids, tos, amts);
            assertEq(escrow.getCampaign(id).remaining, DEPOSIT - total);
            assertEq(escrow.getCampaign(id).paid, total);
            assertEq(usdc.balanceOf(address(escrow)), DEPOSIT - total);
            for (uint256 i = 0; i < n; i++) {
                assertTrue(escrow.isPaid(id, ids[i]));
                assertEq(usdc.balanceOf(tos[i]), amts[i]);
            }
        }
        _assertIdentity(id);
    }

    function test_non_funder_can_never_pay_fuzz(address caller, uint96 amount) public {
        vm.assume(caller != maker);
        bytes32 id = _create();
        amount = uint96(bound(amount, 1, DEPOSIT));
        (bytes32[] memory ids, address[] memory tos, uint96[] memory amts) =
            _one(CONTRIB_1, caller, amount);
        vm.prank(caller);
        vm.expectRevert(FavourCampaignEscrow.NotFunder.selector);
        escrow.payBatch(id, ids, tos, amts);
        assertEq(usdc.balanceOf(address(escrow)), DEPOSIT);
    }
}
