// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FavourEscrowV2} from "../src/FavourEscrowV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys the immutable FavourEscrowV2. No proxy, no initialize, no owner:
///         the deployer key holds zero power over the contract after this transaction.
contract DeployFavourEscrowV2 is Script {
    /// USDC.e on World Chain mainnet (chain id 480).
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    function run() external {
        // Key is supplied via `forge script --private-key` (server env); the deployer
        // address retains no rights over the contract.
        vm.startBroadcast();
        FavourEscrowV2 escrow = new FavourEscrowV2(IERC20(USDC));
        vm.stopBroadcast();

        console.log("FavourEscrowV2:", address(escrow));
    }
}
