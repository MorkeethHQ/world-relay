// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FavourPots} from "../src/FavourPots.sol";
import {PerfectRounds} from "../src/PerfectRounds.sol";
import {IPermit2AllowanceTransfer} from "../src/ManagedUpgradeable.sol";

/// Deploys FavourPots + PerfectRounds behind UUPS proxies on World Chain (480) and configures USDC.
/// Every address comes from env; nothing is hard-coded except the canonical USDC and Permit2.
///   ADMIN          DEFAULT_ADMIN_ROLE holder. Must equal the broadcasting key so setToken runs here.
///   OPERATOR       OPERATOR_ROLE (server key).
///   FEE_RECIPIENT  Oscar's choice.
/// Dry run: forge script script/Deploy.s.sol --fork-url worldchain --sender $ADMIN   (no --broadcast)
contract Deploy is Script {
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint16 constant FEE_BPS = 250; // 2.5%, KEPT 2 Nov
    uint256 constant MIN = 100_000; // 0.1 USDC
    uint256 constant MAX = 1000e6; // 1000 USDC cap per favour / entry price

    function run() external {
        require(block.chainid == 480, "World Chain only");
        address admin = vm.envAddress("ADMIN");
        address operator = vm.envAddress("OPERATOR");
        address feeTo = vm.envAddress("FEE_RECIPIENT");
        require(admin != operator, "admin must differ from operator");
        require(admin != feeTo && operator != feeTo, "fee recipient must be Oscar's own wallet");

        vm.startBroadcast(admin);
        FavourPots fImpl = new FavourPots(IPermit2AllowanceTransfer(PERMIT2));
        FavourPots f = FavourPots(
            address(new ERC1967Proxy(address(fImpl), abi.encodeCall(FavourPots.initialize, (admin, operator, feeTo, FEE_BPS))))
        );
        f.setToken(USDC, true, MIN, MAX);

        PerfectRounds rImpl = new PerfectRounds(IPermit2AllowanceTransfer(PERMIT2));
        PerfectRounds r = PerfectRounds(
            address(new ERC1967Proxy(address(rImpl), abi.encodeCall(PerfectRounds.initialize, (admin, operator, feeTo, FEE_BPS))))
        );
        r.setToken(USDC, true, MIN, MAX);
        vm.stopBroadcast();

        // read back, same checks the card reports
        require(f.feeBps() == FEE_BPS && r.feeBps() == FEE_BPS, "fee");
        require(f.feeRecipient() == feeTo && r.feeRecipient() == feeTo, "feeTo");
        require(f.hasRole(f.DEFAULT_ADMIN_ROLE(), admin) && r.hasRole(r.DEFAULT_ADMIN_ROLE(), admin), "admin");
        require(f.hasRole(f.OPERATOR_ROLE(), operator) && r.hasRole(r.OPERATOR_ROLE(), operator), "operator");
        require(f.UPGRADE_DELAY() == 6 hours && r.UPGRADE_DELAY() == 6 hours, "delay");
        require(f.tokenConfig(USDC).minAmount == MIN && f.tokenConfig(USDC).maxAmount == MAX, "favour token");
        require(r.tokenConfig(USDC).minAmount == MIN && r.tokenConfig(USDC).maxAmount == MAX, "perfect token");
        require(!f.paused() && !r.paused(), "paused");
        require(r.minChallengeWindow() == 1 hours, "window");

        console2.log("FavourPots impl ", address(fImpl));
        console2.log("FavourPots proxy", address(f));
        console2.log("PerfectRounds impl ", address(rImpl));
        console2.log("PerfectRounds proxy", address(r));
    }
}
