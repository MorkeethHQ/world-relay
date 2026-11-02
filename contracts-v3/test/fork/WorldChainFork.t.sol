// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FavourPots} from "../../src/FavourPots.sol";
import {PerfectRounds} from "../../src/PerfectRounds.sol";
import {IPermit2AllowanceTransfer} from "../../src/ManagedUpgradeable.sol";

interface IPermit2Approve {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// Runs against a local fork of World Chain mainnet (chain 480) at a pinned block:
/// real bridged USDC and canonical Permit2. Nothing is broadcast.
/// Run: forge test --match-path test/fork/* (needs network once; the fork is cached).
contract WorldChainForkTest is Test {
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 constant FORK_BLOCK = 37138477; // read 2 Nov 2026
    uint256 constant DIME = 100_000;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address feeTo = makeAddr("feeTo");
    address alice = makeAddr("alice");
    address worker = makeAddr("worker");

    FavourPots f;
    PerfectRounds r;

    function setUp() public {
        vm.createSelectFork("worldchain", FORK_BLOCK);
        require(block.chainid == 480, "not World Chain");
        require(PERMIT2.code.length > 0 && USDC.code.length > 0, "missing code");

        FavourPots fi = new FavourPots(IPermit2AllowanceTransfer(PERMIT2));
        f = FavourPots(address(new ERC1967Proxy(address(fi), abi.encodeCall(FavourPots.initialize, (admin, operator, feeTo, 250)))));
        PerfectRounds ri = new PerfectRounds(IPermit2AllowanceTransfer(PERMIT2));
        r = PerfectRounds(address(new ERC1967Proxy(address(ri), abi.encodeCall(PerfectRounds.initialize, (admin, operator, feeTo, 250)))));
        vm.startPrank(admin);
        f.setToken(USDC, true, DIME, 1000e6);
        r.setToken(USDC, true, DIME, 1000e6);
        vm.stopPrank();

        deal(USDC, alice, 100e6);
        deal(USDC, admin, 100e6);
    }

    function test_fork_deal_sets_real_usdc_balance() public view {
        assertEq(IERC20(USDC).balanceOf(alice), 100e6);
    }

    function _permit2(address who, address spender, uint160 amount) internal {
        vm.startPrank(who);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
        IPermit2Approve(PERMIT2).approve(USDC, spender, amount, uint48(block.timestamp + 1 hours));
        vm.stopPrank();
    }

    function test_fork_favour_dime_campaign_permit2_and_payout() public {
        vm.prank(admin);
        uint256 id = f.openCampaign(USDC, DIME);
        _permit2(alice, address(f), uint160(DIME));
        vm.prank(alice);
        f.fundCampaignWithPermit2(id, DIME);
        assertEq(IERC20(USDC).balanceOf(address(f)), DIME);
        vm.prank(operator);
        f.payFromPot(id, keccak256("fork-1"), worker, DIME);
        assertEq(IERC20(USDC).balanceOf(worker), DIME - (DIME * 250) / 10_000);
        f.withdrawFees(USDC);
        assertEq(IERC20(USDC).balanceOf(feeTo), (DIME * 250) / 10_000);
        assertEq(IERC20(USDC).balanceOf(address(f)), 0);
    }

    function test_fork_favour_single_escrow_permit2_refund() public {
        _permit2(alice, address(f), uint160(2e6));
        vm.prank(alice);
        f.fundFavourWithPermit2(keccak256("fork-s"), USDC, 2e6, address(0), uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days + 1);
        uint256 b0 = IERC20(USDC).balanceOf(alice);
        f.refundFavour(f.favourId(alice, keccak256("fork-s")));
        assertEq(IERC20(USDC).balanceOf(alice) - b0, 2e6);
    }

    function test_fork_permit2_cannot_pull_more_than_approved() public {
        vm.prank(admin);
        uint256 id = f.openCampaign(USDC, 1e6);
        _permit2(alice, address(f), uint160(DIME));
        vm.prank(alice);
        vm.expectRevert();
        f.fundCampaignWithPermit2(id, DIME + 1);
    }

    function test_fork_perfect_round_permit2_settle_claim() public {
        uint64 close = uint64(block.timestamp + 1 hours);
        vm.prank(operator);
        uint256 id = r.openRound(USDC, 1e6, close, close + 1 days, 1 hours);
        _permit2(alice, address(r), uint160(3e6));
        vm.prank(alice);
        r.buyEntriesWithPermit2(id, 3);
        vm.prank(operator);
        r.registerAttempt(id, worker, keccak256("free-try"));
        vm.warp(close);
        vm.prank(operator);
        r.proposeWinner(id, keccak256("free-try"), keccak256("board"));
        vm.warp(close + 1 hours);
        r.settle(id);
        vm.prank(worker);
        r.claim(USDC);
        assertEq(IERC20(USDC).balanceOf(worker), 3e6 - (3e6 * 250) / 10_000);
        r.withdrawFees(USDC);
        assertEq(IERC20(USDC).balanceOf(address(r)), 0);
    }
}
