// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FavourEscrowV2} from "../src/FavourEscrowV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken, IEscrowTarget} from "./mocks/ReentrantToken.sol";

contract FavourEscrowV2Test is Test {
    FavourEscrowV2 internal escrow;
    MockUSDC internal usdc;

    address internal funder = makeAddr("funder");
    address internal recipient = makeAddr("recipient");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant TASK = keccak256("task-1");
    uint96 internal constant AMOUNT = 1_000_000; // 1.00 USDC, 6 decimals
    uint64 internal deadline;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new FavourEscrowV2(IERC20(address(usdc)));
        deadline = uint64(block.timestamp + 7 days);

        usdc.mint(funder, 100_000_000); // 100 USDC
        vm.prank(funder);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _fund() internal {
        vm.prank(funder);
        escrow.fund(TASK, recipient, AMOUNT, deadline);
    }

    // ─── Happy path ─────────────────────────────────────────────────

    function test_fund_release() public {
        _fund();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        vm.prank(funder);
        escrow.release(TASK);

        assertEq(usdc.balanceOf(recipient), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2.Status.Released));
    }

    function test_fund_refund_after_expiry() public {
        _fund();
        uint256 before = usdc.balanceOf(funder);

        vm.warp(deadline + 1);
        vm.prank(attacker); // refund is anyone-callable; money still goes to funder
        escrow.refund(TASK);

        assertEq(usdc.balanceOf(funder), before + AMOUNT);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2.Status.Refunded));
    }

    function test_fund_binds_all_fields() public {
        _fund();
        FavourEscrowV2.Escrow memory e = escrow.getEscrow(TASK);
        assertEq(e.funder, funder);
        assertEq(e.recipient, recipient);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deadline, deadline);
    }

    // ─── Input validation ───────────────────────────────────────────

    function test_fund_rejects_zero_recipient() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2.ZeroAddress.selector);
        escrow.fund(TASK, address(0), AMOUNT, deadline);
    }

    function test_fund_rejects_zero_amount() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2.ZeroAmount.selector);
        escrow.fund(TASK, recipient, 0, deadline);
    }

    function test_fund_rejects_past_and_present_deadline() public {
        vm.startPrank(funder);
        vm.expectRevert(FavourEscrowV2.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp));
        vm.expectRevert(FavourEscrowV2.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp - 1));
        vm.stopPrank();
    }

    function test_fund_rejects_deadline_beyond_max_duration() public {
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2.DeadlineInvalid.selector);
        escrow.fund(TASK, recipient, AMOUNT, uint64(block.timestamp + 180 days + 1));
    }

    function test_constructor_rejects_zero_token() public {
        vm.expectRevert(FavourEscrowV2.ZeroAddress.selector);
        new FavourEscrowV2(IERC20(address(0)));
    }

    // ─── CLASS: wrong-recipient / redirect (question-swap analog) ───

    function test_release_pays_only_bound_recipient() public {
        _fund();
        // No function signature accepts a destination post-fund; release moves the
        // exact bound amount to the exact bound recipient regardless of caller intent.
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

        // Re-funding the same task id (to swap recipients) is blocked forever.
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2.TaskAlreadyFunded.selector);
        escrow.fund(TASK, attacker, AMOUNT, uint64(block.timestamp + 1 days));
    }

    function test_taskId_cannot_be_released_and_rebound() public {
        _fund();
        vm.prank(funder);
        escrow.release(TASK);

        vm.prank(attacker);
        vm.expectRevert(FavourEscrowV2.TaskAlreadyFunded.selector);
        escrow.fund(TASK, attacker, 1, uint64(block.timestamp + 1 days));
    }

    function test_release_only_funder() public {
        _fund();
        vm.prank(attacker);
        vm.expectRevert(FavourEscrowV2.NotFunder.selector);
        escrow.release(TASK);
        vm.prank(recipient);
        vm.expectRevert(FavourEscrowV2.NotFunder.selector);
        escrow.release(TASK);
    }

    function test_double_release_blocked() public {
        _fund();
        vm.startPrank(funder);
        escrow.release(TASK);
        vm.expectRevert(FavourEscrowV2.TaskNotFunded.selector);
        escrow.release(TASK);
        vm.stopPrank();
    }

    function test_release_then_refund_blocked() public {
        _fund();
        vm.prank(funder);
        escrow.release(TASK);
        vm.warp(deadline + 1);
        vm.expectRevert(FavourEscrowV2.TaskNotFunded.selector);
        escrow.refund(TASK);
    }

    function test_refund_then_release_blocked() public {
        _fund();
        vm.warp(deadline + 1);
        escrow.refund(TASK);
        vm.prank(funder);
        vm.expectRevert(FavourEscrowV2.TaskNotFunded.selector);
        escrow.release(TASK);
    }

    // ─── CLASS: expiry / timestamp games ────────────────────────────

    function test_refund_blocked_at_exact_deadline() public {
        _fund();
        vm.warp(deadline); // block.timestamp == deadline: not yet expired
        vm.expectRevert(FavourEscrowV2.NotExpired.selector);
        escrow.refund(TASK);
    }

    function test_refund_allowed_one_second_after_deadline() public {
        _fund();
        vm.warp(uint256(deadline) + 1);
        escrow.refund(TASK);
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2.Status.Refunded));
    }

    function test_release_still_works_after_deadline() public {
        // Late completion: funder may still choose to pay after expiry.
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
        vm.expectRevert(FavourEscrowV2.NotExpired.selector);
        escrow.refund(TASK);
    }

    // ─── CLASS: approval abuse ──────────────────────────────────────

    function test_attacker_cannot_spend_third_party_approval() public {
        // funder approved the escrow. Attacker funds a task — the pull can only come
        // from msg.sender (attacker), never from funder's allowance.
        vm.prank(attacker);
        vm.expectRevert(); // attacker has no balance/approval of their own
        escrow.fund(keccak256("evil"), attacker, AMOUNT, deadline);

        // Funder's balance untouched.
        assertEq(usdc.balanceOf(funder), 100_000_000);
    }

    function test_fund_pulls_exactly_amount() public {
        _fund();
        assertEq(usdc.balanceOf(funder), 100_000_000 - AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    // ─── CLASS: reentrancy ──────────────────────────────────────────

    function test_reentrancy_on_release_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        FavourEscrowV2 esc2 = new FavourEscrowV2(IERC20(address(evil)));

        evil.mint(funder, 10_000_000);
        vm.startPrank(funder);
        evil.approve(address(esc2), type(uint256).max);
        esc2.fund(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();

        // During the release transfer, the token re-calls release(TASK).
        // ReentrantToken REVERTS the whole tx if the inner call unexpectedly succeeds.
        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourEscrowV2.release, (TASK))
        );
        vm.prank(funder);
        esc2.release(TASK); // must complete: inner reentrant call reverted, outer fine
        assertEq(evil.balanceOf(recipient), AMOUNT);
        assertEq(uint8(esc2.getEscrow(TASK).status), uint8(FavourEscrowV2.Status.Released));
    }

    function test_reentrancy_on_refund_blocked() public {
        ReentrantToken evil = new ReentrantToken();
        FavourEscrowV2 esc2 = new FavourEscrowV2(IERC20(address(evil)));

        evil.mint(funder, 10_000_000);
        vm.startPrank(funder);
        evil.approve(address(esc2), type(uint256).max);
        esc2.fund(TASK, recipient, AMOUNT, deadline);
        vm.stopPrank();

        evil.setAttack(
            IEscrowTarget(address(esc2)), abi.encodeCall(FavourEscrowV2.refund, (TASK))
        );
        vm.warp(deadline + 1);
        escrowRefund(esc2); // anyone-callable
        assertEq(evil.balanceOf(funder), 10_000_000);
    }

    function escrowRefund(FavourEscrowV2 esc2) internal {
        esc2.refund(TASK);
    }

    // ─── CLASS: stuck funds / griefing ──────────────────────────────

    function test_every_funded_escrow_has_two_exits_fuzz(
        uint96 amount,
        uint64 duration,
        bool useRelease
    ) public {
        amount = uint96(bound(amount, 1, 100_000_000));
        duration = uint64(bound(duration, 1, 180 days));
        uint64 dl = uint64(block.timestamp + duration);
        bytes32 id = keccak256(abi.encode(amount, duration));

        vm.prank(funder);
        escrow.fund(id, recipient, amount, dl);

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
        vm.expectRevert(FavourEscrowV2.NotExpired.selector);
        escrow.refund(TASK);
    }

    // ─── CLASS: USDC-specific quirks ────────────────────────────────

    function test_six_decimal_amounts_exact() public {
        // 0.000001 USDC (1 unit) and odd amounts must round-trip exactly — no fee math.
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

        // Funds are NOT stuck: state was not consumed by the failed release,
        // and the refund exit still works after expiry.
        assertEq(uint8(escrow.getEscrow(TASK).status), uint8(FavourEscrowV2.Status.Funded));
        vm.warp(deadline + 1);
        escrow.refund(TASK);
        assertEq(usdc.balanceOf(funder), 100_000_000);
    }

    function test_blocklisted_funder_can_still_pay_recipient() public {
        _fund();
        usdc.setBlocklisted(funder, true);

        // Refund would revert (funder can't receive) — but release still exits.
        vm.warp(deadline + 1);
        vm.expectRevert("USDC: recipient blocklisted");
        escrow.refund(TASK);

        vm.prank(funder);
        escrow.release(TASK);
        assertEq(usdc.balanceOf(recipient), AMOUNT);
    }
}
