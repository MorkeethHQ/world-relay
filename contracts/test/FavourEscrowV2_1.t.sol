// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FavourEscrowV2_1, IPermit2AllowanceTransfer} from "../src/FavourEscrowV2_1.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {ReentrantToken, IEscrowTarget} from "./mocks/ReentrantToken.sol";

/// @dev Full port of the FavourEscrowV2 suite against V2_1 (every prior failure
///      class re-run) PLUS the Permit2 AllowanceTransfer class introduced by
///      fundWithPermit2: missing/short/expired/wrong-spender allowances, allowance
///      replay, and third-party-allowance abuse through the Permit2 layer.
contract FavourEscrowV2_1Test is Test {
    FavourEscrowV2_1 internal escrow;
    MockUSDC internal usdc;
    MockPermit2 internal permit2;

    address internal funder = makeAddr("funder");
    address internal recipient = makeAddr("recipient");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant TASK = keccak256("task-1");
    uint96 internal constant AMOUNT = 1_000_000; // 1.00 USDC, 6 decimals
    uint64 internal deadline;

    function setUp() public {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
        escrow = new FavourEscrowV2_1(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2))
        );
        deadline = uint64(block.timestamp + 7 days);

        usdc.mint(funder, 100_000_000); // 100 USDC
        vm.startPrank(funder);
        usdc.approve(address(escrow), type(uint256).max);
        // World App auto-approves tokens to Permit2 at the token level; mirror that.
        usdc.approve(address(permit2), type(uint256).max);
        vm.stopPrank();
    }

    function _fund() internal {
        vm.prank(funder);
        escrow.fund(TASK, recipient, AMOUNT, deadline);
    }

    /// The exact World App batch: permit2.approve(USDC, escrow, amount, 0) followed by
    /// fundWithPermit2 in the same block (expiration 0 = valid this block only).
    function _fundWithPermit2() internal {
        vm.startPrank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT, 0);
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();
    }

    // ─── CLASS: Permit2 fund path ───────────────────────────────────

    function test_p2_fund_release() public {
        _fundWithPermit2();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(funder), 100_000_000 - AMOUNT);

        FavourEscrowV2_1.Escrow memory e = escrow.getEscrow(TASK);
        assertEq(e.funder, funder);
        assertEq(e.recipient, recipient);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deadline, deadline);

        vm.prank(funder);
        escrow.release(TASK);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_p2_fund_refund_after_expiry() public {
        _fundWithPermit2();
        vm.warp(deadline + 1);
        vm.prank(attacker); // anyone-callable; destination is chain-bound to funder
        escrow.refund(TASK);
        assertEq(usdc.balanceOf(funder), 100_000_000);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_p2_fund_without_permit2_allowance_reverts() public {
        vm.prank(funder);
        vm.expectRevert(); // AllowanceExpired(0): no allowance was ever granted
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, deadline);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.None));
    }

    function test_p2_permit_amount_smaller_than_fund_amount_reverts() public {
        // Amount mismatch between the permit and the record must fail closed.
        vm.startPrank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT - 1, 0);
        vm.expectRevert(
            abi.encodeWithSelector(MockPermit2.InsufficientAllowance.selector, AMOUNT - 1)
        );
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.None));
    }

    function test_p2_expired_permit_reverts() public {
        // expiration 0 = this block only (canonical Permit2 semantics). One second
        // later the allowance is dead — the World App batch executes same-block.
        vm.startPrank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT, 0);
        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, uint64(block.timestamp + 7 days));
        vm.stopPrank();
    }

    function test_p2_allowance_granted_to_other_spender_unusable() public {
        // Permit granted to a DIFFERENT spender must not fund this escrow.
        vm.startPrank(funder);
        permit2.approve(address(usdc), attacker, AMOUNT, 0);
        vm.expectRevert();
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();
    }

    function test_p2_allowance_replay_blocked() public {
        // The allowance is consumed by the first fund; a second fund (fresh task id)
        // cannot replay it.
        _fundWithPermit2();
        vm.prank(funder);
        vm.expectRevert();
        escrow.fundWithPermit2(keccak256("task-2"), recipient, AMOUNT, deadline);
        // And the same task id is sealed regardless of allowance.
        vm.startPrank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT, 0);
        vm.expectRevert(FavourEscrowV2_1.TaskAlreadyFunded.selector);
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();
    }

    function test_p2_attacker_cannot_spend_funders_permit() public {
        // funder granted the escrow a Permit2 allowance, but the pull is always
        // from msg.sender — the attacker's own (empty) allowance is consulted.
        vm.prank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT, 0);
        vm.prank(attacker);
        vm.expectRevert();
        escrow.fundWithPermit2(keccak256("evil"), attacker, AMOUNT, deadline);
        assertEq(usdc.balanceOf(funder), 100_000_000);
    }

    function test_p2_input_validation_matches_fund() public {
        vm.startPrank(funder);
        permit2.approve(address(usdc), address(escrow), AMOUNT, 0);
        vm.expectRevert(FavourEscrowV2_1.ZeroAddress.selector);
        escrow.fundWithPermit2(TASK, address(0), AMOUNT, deadline);
        vm.expectRevert(FavourEscrowV2_1.ZeroAmount.selector);
        escrow.fundWithPermit2(TASK, recipient, 0, deadline);
        vm.expectRevert(FavourEscrowV2_1.DeadlineInvalid.selector);
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, uint64(block.timestamp));
        vm.expectRevert(FavourEscrowV2_1.DeadlineInvalid.selector);
        escrow.fundWithPermit2(TASK, recipient, AMOUNT, uint64(block.timestamp + 180 days + 1));
        vm.stopPrank();
    }

    function test_p2_and_plain_fund_write_identical_records() public {
        _fundWithPermit2();
        bytes32 other = keccak256("task-plain");
        vm.prank(funder);
        escrow.fund(other, recipient, AMOUNT, deadline);

        FavourEscrowV2_1.Escrow memory a = escrow.getEscrow(TASK);
        FavourEscrowV2_1.Escrow memory b = escrow.getEscrow(other);
        assertEq(a.funder, b.funder);
        assertEq(a.recipient, b.recipient);
        assertEq(a.amount, b.amount);
        assertEq(a.deadline, b.deadline);
        assertEq(uint8(a.status), uint8(b.status));
    }

    function test_constructor_rejects_zero_permit2() public {
        vm.expectRevert(FavourEscrowV2_1.ZeroAddress.selector);
        new FavourEscrowV2_1(IERC20(address(usdc)), IPermit2AllowanceTransfer(address(0)));
    }

    // ─── Happy path (ported) ────────────────────────────────────────

    function test_fund_release() public {
        _fund();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        vm.prank(funder);
        escrow.release(TASK);

        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.Released));
    }

    function test_fund_refund_after_expiry() public {
        _fund();
        uint256 before = usdc.balanceOf(funder);

        vm.warp(deadline + 1);
        vm.prank(attacker); // refund is anyone-callable; money still goes to funder
        escrow.refund(TASK);

        assertEq(usdc.balanceOf(funder), before + AMOUNT);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.Refunded));
    }

    function test_fund_binds_all_fields() public {
        _fund();
        FavourEscrowV2_1.Escrow memory e = escrow.getEscrow(TASK);
        assertEq(e.funder, funder);
        assertEq(e.recipient, recipient);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deadline, deadline);
    }

    // ─── Input validation (ported) ──────────────────────────────────

    function test_fund_rejects_zero_recipient() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2_1.ZeroAddress.selector);
        escrow.fund(TASK, address(0), AMOUNT, deadline);
    }

    function test_fund_rejects_zero_amount() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2_1.ZeroAmount.selector);
        escrow.fund(TASK, recipient, 0, deadline);
    }

    function test_fund_rejects_past_and_present_deadline() public {
        vm.startPrank(funder);
        vm.expectRevert(FavourEscrowV2_1.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp));
        vm.expectRevert(FavourEscrowV2_1.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp - 1));
        vm.stopPrank();
    }

    function test_fund_rejects_deadline_beyond_max_duration() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2_1.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp + 180 days + 1));
    }

    function test_constructor_rejects_zero_token() public {
        vm.expectRevert(FavourEscrowV2_1.ZeroAddress.selector);
        new FavourEscrowV2_1(IERC20(address(0)), IPermit2AllowanceTransfer(address(permit2)));
    }

    // ─── CLASS: wrong-recipient / redirect (ported) ─────────────────

    function test_release_pays_only_bound_recipient() public {
        _fund();
        vm.prank(funder);
        escrow.release(TASK);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(funder), 100_000_000 - AMOUNT);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_taskId_cannot_be_refunded_and_rebound() public {
        _fund();
        vm.warp(deadline + 1);
        escrow.refund(TASK);

        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2_1.TaskAlreadyFunded.selector);
        escrow.fund(TASK, attacker, AMOUNT, uint64(block.timestamp + 1 days));
    }

    function test_taskId_cannot_be_released_and_rebound() public {
        _fund();
        vm.prank(funder);
        escrow.release(TASK);

        vm.prank(attacker);
        vm.expectRevert(FavourEscrowV2_1.TaskAlreadyFunded.selector);
        escrow.fund(TASK, attacker, 1, uint64(block.timestamp + 1 days));
    }

    function test_release_only_funder() public {
        _fund();
        vm.prank(attacker);
        vm.expectRevert(FavourEscrowV2_1.NotFunder.selector);
        escrow.release(TASK);
        vm.prank(recipient);
        vm.expectRevert(FavourEscrowV2_1.NotFunder.selector);
        escrow.release(TASK);
    }

    function test_double_release_blocked() public {
        _fund();
        vm.startPrank(funder);
        escrow.release(TASK);
        vm.expectRevert(FavourEscrowV2_1.TaskNotFunded.selector);
        escrow.release(TASK);
        vm.stopPrank();
    }

    function test_release_then_refund_blocked() public {
        _fund();
        vm.prank(funder);
        escrow.release(TASK);
        vm.warp(deadline + 1);
        vm.expectRevert(FavourEscrowV2_1.TaskNotFunded.selector);
        escrow.refund(TASK);
    }

    function test_refund_then_release_blocked() public {
        _fund();
        vm.warp(deadline + 1);
        escrow.refund(TASK);
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2_1.TaskNotFunded.selector);
        escrow.release(TASK);
    }

    // ─── CLASS: expiry / timestamp games (ported) ───────────────────

    function test_refund_blocked_at_exact_deadline() public {
        _fund();
        vm.warp(deadline);
        vm.expectRevert(FavourEscrowV2_1.NotExpired.selector);
        escrow.refund(TASK);
    }

    function test_refund_allowed_one_second_after_deadline() public {
        _fund();
        vm.warp(uint256(deadline) + 1);
        escrow.refund(TASK);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.Refunded));
    }

    function test_release_still_works_after_deadline() public {
        _fund();
        vm.warp(deadline + 30 days);
        vm.prank(funder);
        escrow.release(TASK);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }

    function test_refund_never_callable_before_deadline_fuzz(uint64 warpTo) public {
        _fund();
        warpTo = uint64(bound(warpTo, block.timestamp, deadline));
        vm.warp(warpTo);
        vm.expectRevert(FavourEscrowV2_1.NotExpired.selector);
        escrow.refund(TASK);
    }

    // ─── CLASS: approval abuse (ported) ─────────────────────────────

    function test_attacker_cannot_spend_third_party_approval() public {
        vm.prank(attacker);
        vm.expectRevert(); // attacker has no balance/approval of their own
        escrow.fund(keccak256("evil"), attacker, AMOUNT, deadline);

        assertEq(usdc.balanceOf(funder), 100_000_000);
    }

    function test_fund_pulls_exactly_amount() public {
        _fund();
        assertEq(usdc.balanceOf(funder), 100_000_000 - AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    // ─── CLASS: reentrancy (ported; release/refund shared by both paths) ──

    function test_reentrancy_on_release_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        FavourEscrowV2_1 esc2 = new FavourEscrowV2_1(
            IERC20(address(evil)), IPermit2AllowanceTransfer(address(permit2))
        );

        evil.mint(funder, 10_000_000);
        vm.startPrank(funder);
        evil.approve(address(esc2), type(uint256).max);
        esc2.fund(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();

        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourEscrowV2_1.release, (TASK))
        );
        vm.prank(funder);
        esc2.release(TASK);
        assertEq(evil.balanceOf(recipient), AMOUNT);
        assertEq(uint8(esc2.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.Released));
    }

    function test_reentrancy_on_refund_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        FavourEscrowV2_1 esc2 = new FavourEscrowV2_1(
            IERC20(address(evil)), IPermit2AllowanceTransfer(address(permit2))
        );

        evil.mint(funder, 10_000_000);
        vm.startPrank(funder);
        evil.approve(address(esc2), type(uint256).max);
        esc2.fund(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();

        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourEscrowV2_1.refund, (TASK))
        );
        vm.warp(deadline + 1);
        esc2.refund(TASK);
        assertEq(evil.balanceOf(funder), 10_000_000);
    }

    // ─── CLASS: stuck funds / griefing (ported) ─────────────────────

    function test_every_funded_escrow_has_two_exits_fuzz(
        uint96 amount,
        uint64 duration,
        bool useRelease,
        bool viaPermit2
    ) public {
        amount = uint96(bound(amount, 1, 100_000_000));
        duration = uint64(bound(duration, 1, 180 days));
        uint64 dl = uint64(block.timestamp + duration);
        bytes32 id = keccak256(abi.encode(amount, duration, viaPermit2));

        if (viaPermit2) {
            vm.startPrank(funder);
            permit2.approve(address(usdc), address(escrow), amount, 0);
            escrow.fundWithPermit2(id, recipient, amount, dl);
            vm.stopPrank();
        } else {
            vm.prank(funder);
            escrow.fund(id, recipient, amount, dl);
        }

        if (useRelease) {
            vm.prank(funder);
            escrow.release(id);
            assertEq(usdc.balanceOf(recipient), amount);
        } else {
            vm.warp(uint256(dl) + 1);
            escrow.refund(id);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0, "no residue may remain");
    }

    function test_third_party_cannot_grief_by_early_refund() public {
        _fund();
        vm.prank(attacker);
        vm.expectRevert(FavourEscrowV2_1.NotExpired.selector);
        escrow.refund(TASK);
    }

    // ─── CLASS: USDC-specific quirks (ported) ───────────────────────

    function test_six_decimal_amounts_exact() public {
        bytes32 id = keccak256("dust");
        vm.prank(funder);
        escrow.fund(id, recipient, 1, deadline);
        vm.prank(funder);
        escrow.release(id);
        assertEq(usdc.balanceOf(recipient), 1);

        bytes32 id2 = keccak256("odd");
        vm.prank(funder);
        escrow.fund(id2, recipient, 333_333, deadline);
        vm.prank(funder);
        escrow.release(id2);
        assertEq(usdc.balanceOf(recipient), 1 + 333_333);
    }

    function test_blocklisted_recipient_release_reverts_refund_still_exits() public {
        _fund();
        usdc.setBlocklisted(recipient, true);

        vm.prank(funder);
        vm.expectRevert("USDC: recipient blocklisted");
        escrow.release(TASK);

        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2_1.Status.Funded));
        vm.warp(deadline + 1);
        escrow.refund(TASK);
        assertEq(usdc.balanceOf(funder), 100_000_000);
    }

    function test_blocklisted_funder_can_still_pay_recipient() public {
        _fund();
        usdc.setBlocklisted(funder, true);

        vm.warp(deadline + 1);
        vm.expectRevert("USDC: recipient blocklisted");
        escrow.refund(TASK);

        vm.prank(funder);
        escrow.release(TASK);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }
}
