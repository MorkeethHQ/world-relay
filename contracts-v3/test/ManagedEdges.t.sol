// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./utils/Base.t.sol";
import {MockUSDC} from "./utils/Mocks.sol";
import {FavourPots} from "../src/FavourPots.sol";
import {PerfectRounds} from "../src/PerfectRounds.sol";
import {ManagedUpgradeable, IPermit2AllowanceTransfer} from "../src/ManagedUpgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Takes 1% on every transfer: the contracts must refuse it rather than over-promise.
contract FeeOnTransferToken is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 cut = value / 100;
            super._update(from, address(0xdead), cut);
            value -= cut;
        }
        super._update(from, to, value);
    }
}

contract ManagedEdgesTest is BaseTest {
    FavourPots internal f;

    function setUp() public {
        _deployMocks();
        f = _deployFavour(address(usdc), address(permit2));
    }

    function test_constructor_rejects_zero_permit2() public {
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        new FavourPots(IPermit2AllowanceTransfer(address(0)));
    }

    function test_initialize_rejects_zero_admin_operator_fee_recipient() public {
        FavourPots impl = new FavourPots(IPermit2AllowanceTransfer(address(permit2)));
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FavourPots.initialize, (address(0), operator, feeTo, 0)));
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FavourPots.initialize, (admin, address(0), feeTo, 0)));
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FavourPots.initialize, (admin, operator, address(0), 0)));
        vm.expectRevert(ManagedUpgradeable.FeeTooHigh.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FavourPots.initialize, (admin, operator, feeTo, 1001)));
    }

    function test_set_token_zero_and_overflow() public {
        vm.startPrank(admin);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        f.setToken(address(0), true, 1, 2);
        vm.expectRevert(ManagedUpgradeable.AmountOutOfRange.selector);
        f.setToken(address(usdc), true, 1, uint256(type(uint128).max) + 1);
        vm.stopPrank();
    }

    function test_disallowed_token_blocks_money_in_but_not_payouts() public {
        _fundAndApprove(admin, address(f), 100 * ONE);
        vm.startPrank(admin);
        uint256 id = f.openCampaign(address(usdc), 5 * ONE);
        f.fundCampaign(id, 10 * ONE);
        f.setToken(address(usdc), false, DIME, 1000 * ONE);
        vm.expectRevert(ManagedUpgradeable.TokenNotAllowed.selector);
        f.fundCampaign(id, ONE);
        f.payFromPot(id, keccak256("x"), carol, ONE); // exit still works
        vm.stopPrank();
        assertGt(usdc.balanceOf(carol), 0);
    }

    function test_fee_on_transfer_token_refused() public {
        FeeOnTransferToken t = new FeeOnTransferToken();
        vm.prank(admin);
        f.setToken(address(t), true, DIME, 1000 * ONE);
        t.mint(alice, 10 * ONE);
        vm.startPrank(alice);
        t.approve(address(f), type(uint256).max);
        vm.expectRevert(ManagedUpgradeable.UnexpectedAmountReceived.selector);
        f.fundFavour(keccak256("fot"), address(t), ONE, address(0), uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_sweep_rejects_zero_recipient_and_non_admin() public {
        vm.prank(admin);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        f.sweepExcess(address(usdc), address(0));
        vm.prank(operator);
        vm.expectRevert();
        f.sweepExcess(address(usdc), operator);
    }

    function test_withdraw_fees_nothing_reverts() public {
        vm.expectRevert(ManagedUpgradeable.NothingToClaim.selector);
        f.withdrawFees(address(usdc));
    }

    function test_role_handover_admin_to_new_wallet() public {
        // the planned move to a safer wallet once > 1000 USDC is deployed (Oscar, 2 Nov)
        address safe = makeAddr("safe");
        vm.startPrank(admin);
        f.grantRole(f.DEFAULT_ADMIN_ROLE(), safe);
        f.renounceRole(f.DEFAULT_ADMIN_ROLE(), admin);
        vm.stopPrank();
        assertTrue(f.hasRole(f.DEFAULT_ADMIN_ROLE(), safe));
        assertFalse(f.hasRole(f.DEFAULT_ADMIN_ROLE(), admin));
        vm.prank(admin);
        vm.expectRevert();
        f.setFee(0, admin);
    }

    function test_revoked_operator_cannot_pay() public {
        _fundAndApprove(admin, address(f), 100 * ONE);
        vm.startPrank(admin);
        uint256 id = f.openCampaign(address(usdc), 5 * ONE);
        f.fundCampaign(id, 10 * ONE);
        f.revokeRole(f.OPERATOR_ROLE(), operator);
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(ManagedUpgradeable.NotOperatorOrAdmin.selector);
        f.payFromPot(id, keccak256("x"), operator, ONE);
    }

    function test_perfect_register_rejects_zero_player_and_hash() public {
        PerfectRounds r = _deployPerfect(address(usdc), address(permit2));
        vm.startPrank(operator);
        uint256 id = r.openRound(address(usdc), ONE, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 2 hours), 1 hours);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        r.registerAttempt(id, address(0), keccak256("x"));
        vm.expectRevert(PerfectRounds.AttemptUnknown.selector);
        r.registerAttempt(id, alice, bytes32(0));
        vm.warp(block.timestamp + 3 hours);
        vm.expectRevert(PerfectRounds.TooLate.selector);
        r.registerAttempt(id, alice, keccak256("late"));
        vm.stopPrank();
    }
}
