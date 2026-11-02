// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDC, MockPermit2} from "./Mocks.sol";
import {FavourPots} from "../../src/FavourPots.sol";
import {PerfectRounds} from "../../src/PerfectRounds.sol";
import {IPermit2AllowanceTransfer} from "../../src/ManagedUpgradeable.sol";

abstract contract BaseTest is Test {
    uint256 internal constant ONE = 1e6; // 1 USDC
    uint256 internal constant DIME = 100_000; // 0.1 USDC, Oscar's must
    uint16 internal constant FEE = 250; // 2.5%, ruled 2 Nov

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal feeTo = makeAddr("feeTo");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    MockUSDC internal usdc;
    MockPermit2 internal permit2;

    function _deployMocks() internal {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
    }

    function _deployFavour(address token, address p2) internal returns (FavourPots f) {
        FavourPots impl = new FavourPots(IPermit2AllowanceTransfer(p2));
        bytes memory init = abi.encodeCall(FavourPots.initialize, (admin, operator, feeTo, FEE));
        f = FavourPots(address(new ERC1967Proxy(address(impl), init)));
        vm.prank(admin);
        f.setToken(token, true, DIME, 1000 * ONE);
    }

    function _deployPerfect(address token, address p2) internal returns (PerfectRounds r) {
        PerfectRounds impl = new PerfectRounds(IPermit2AllowanceTransfer(p2));
        bytes memory init = abi.encodeCall(PerfectRounds.initialize, (admin, operator, feeTo, FEE));
        r = PerfectRounds(address(new ERC1967Proxy(address(impl), init)));
        vm.prank(admin);
        r.setToken(token, true, DIME, 1000 * ONE);
    }

    function _fundAndApprove(address who, address spender, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }
}
