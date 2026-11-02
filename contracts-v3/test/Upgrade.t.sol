// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "./utils/Base.t.sol";
import {FavourPots} from "../src/FavourPots.sol";
import {PerfectRounds} from "../src/PerfectRounds.sol";
import {ManagedUpgradeable, IPermit2AllowanceTransfer} from "../src/ManagedUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// A later FAVOUR version, the shape a real upgrade takes: same storage, one new function.
contract FavourPotsV2Mock is FavourPots {
    constructor(IPermit2AllowanceTransfer p) FavourPots(p) {}

    function version() external pure override returns (string memory) {
        return "favour-pots-2-mock";
    }
}

contract PerfectRoundsV2Mock is PerfectRounds {
    constructor(IPermit2AllowanceTransfer p) PerfectRounds(p) {}

    function version() external pure override returns (string memory) {
        return "perfect-rounds-2-mock";
    }
}

/// Not UUPS: OZ must refuse it, so a bad upgrade cannot brick the proxy.
contract NotUpgradeable {
    function hello() external pure returns (uint256) {
        return 1;
    }
}

contract UpgradeTest is BaseTest {
    FavourPots internal f;
    PerfectRounds internal r;

    function setUp() public {
        _deployMocks();
        f = _deployFavour(address(usdc), address(permit2));
        r = _deployPerfect(address(usdc), address(permit2));
        _fundAndApprove(admin, address(f), 100 * ONE);
        _fundAndApprove(alice, address(f), 100 * ONE);
    }

    function test_upgrade_without_schedule_reverts() public {
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ManagedUpgradeable.UpgradeNotScheduled.selector, impl));
        f.upgradeToAndCall(impl, "");
    }

    function test_upgrade_before_6h_reverts_and_after_works_state_kept() public {
        vm.prank(admin);
        uint256 id = f.openCampaign(address(usdc), 5 * ONE);
        vm.prank(admin);
        f.fundCampaign(id, 20 * ONE);
        vm.prank(alice);
        f.fundFavour(keccak256("k"), address(usdc), 3 * ONE, address(0), uint64(block.timestamp + 30 days));

        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.prank(admin);
        f.scheduleUpgrade(impl);
        assertEq(f.upgradeEta(impl), block.timestamp + 6 hours);

        vm.warp(block.timestamp + 6 hours - 1);
        vm.prank(admin);
        vm.expectRevert();
        f.upgradeToAndCall(impl, "");

        vm.warp(block.timestamp + 1);
        vm.prank(admin);
        f.upgradeToAndCall(impl, "");
        assertEq(f.version(), "favour-pots-2-mock");

        // every balance and record survives
        assertEq(f.getCampaign(id).balance, 20 * ONE);
        assertEq(f.contributed(id, admin), 20 * ONE);
        assertEq(f.getFavour(keccak256("k")).amount, 3 * ONE);
        assertEq(f.owed(address(usdc)), 23 * ONE);
        assertEq(f.feeBps(), FEE);
        assertTrue(f.hasRole(f.OPERATOR_ROLE(), operator));
        assertEq(f.upgradeEta(impl), 0); // one schedule, one use

        // and the upgraded contract still pays out
        vm.prank(operator);
        f.payFromPot(id, keccak256("after"), carol, ONE);
        assertEq(usdc.balanceOf(carol), ONE - (ONE * FEE) / 10_000);
    }

    function test_schedule_is_single_use() public {
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.prank(admin);
        f.scheduleUpgrade(impl);
        vm.warp(block.timestamp + 6 hours);
        vm.prank(admin);
        f.upgradeToAndCall(impl, "");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ManagedUpgradeable.UpgradeNotScheduled.selector, impl));
        f.upgradeToAndCall(impl, "");
    }

    function test_non_admin_cannot_schedule_or_upgrade() public {
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.scheduleUpgrade(impl);
        vm.prank(admin);
        f.scheduleUpgrade(impl);
        vm.warp(block.timestamp + 7 hours);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)));
        f.upgradeToAndCall(impl, "");
    }

    function test_cancel_upgrade() public {
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.startPrank(admin);
        f.scheduleUpgrade(impl);
        f.cancelUpgrade(impl);
        vm.warp(block.timestamp + 7 hours);
        vm.expectRevert(abi.encodeWithSelector(ManagedUpgradeable.UpgradeNotScheduled.selector, impl));
        f.upgradeToAndCall(impl, "");
        vm.stopPrank();
    }

    function test_schedule_rejects_zero_and_eoa() public {
        vm.startPrank(admin);
        vm.expectRevert(ManagedUpgradeable.ZeroAddress.selector);
        f.scheduleUpgrade(address(0));
        vm.expectRevert(ManagedUpgradeable.NotAContract.selector);
        f.scheduleUpgrade(stranger);
        vm.stopPrank();
    }

    function test_upgrade_to_non_uups_refused() public {
        address impl = address(new NotUpgradeable());
        vm.prank(admin);
        f.scheduleUpgrade(impl);
        vm.warp(block.timestamp + 6 hours);
        vm.prank(admin);
        vm.expectRevert();
        f.upgradeToAndCall(impl, "");
        assertEq(f.version(), "favour-pots-3.0.0");
    }

    function test_perfect_upgrade_after_timelock() public {
        address impl = address(new PerfectRoundsV2Mock(r.PERMIT2()));
        vm.prank(admin);
        r.scheduleUpgrade(impl);
        vm.prank(admin);
        vm.expectRevert();
        r.upgradeToAndCall(impl, "");
        vm.warp(block.timestamp + 6 hours);
        vm.prank(admin);
        r.upgradeToAndCall(impl, "");
        assertEq(r.version(), "perfect-rounds-2-mock");
    }

    function testFuzz_upgrade_never_before_delay(uint256 wait) public {
        wait = bound(wait, 0, 6 hours - 1);
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.prank(admin);
        f.scheduleUpgrade(impl);
        vm.warp(block.timestamp + wait);
        vm.prank(admin);
        vm.expectRevert();
        f.upgradeToAndCall(impl, "");
    }

    function test_upgrade_events_emitted() public {
        address impl = address(new FavourPotsV2Mock(f.PERMIT2()));
        vm.expectEmit(true, false, false, true, address(f));
        emit ManagedUpgradeable.UpgradeScheduled(impl, block.timestamp + 6 hours);
        vm.prank(admin);
        f.scheduleUpgrade(impl);
    }
}
