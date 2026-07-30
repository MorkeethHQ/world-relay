// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FavourEscrowV2_1, IPermit2AllowanceTransfer} from "../src/FavourEscrowV2_1.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys the immutable FavourEscrowV2_1. No proxy, no initialize, no owner:
///         the deployer key holds zero power over the contract after this transaction.
contract DeployFavourEscrowV2_1 is Script {
    /// USDC.e on World Chain mainnet (chain id 480).
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    /// Canonical Permit2 (same address on every chain; code verified present on 480).
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        vm.startBroadcast();
        FavourEscrowV2_1 escrow =
            new FavourEscrowV2_1(IERC20(USDC), IPermit2AllowanceTransfer(PERMIT2));
        vm.stopBroadcast();

        console.log("FavourEscrowV2_1:", address(escrow));
    }
}
