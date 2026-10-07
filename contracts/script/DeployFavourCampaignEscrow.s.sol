// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FavourCampaignEscrow, IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys the immutable FavourCampaignEscrow. No proxy, no initialize, no
///         owner: the deployer key holds zero power over the contract after this
///         transaction.
/// @dev NOT RUN. This script was written and compiled only. Deploying, verifying the
///      source on the explorer and enabling intake are Oscar's click. Both addresses
///      below are copied from DeployFavourEscrowV2_1.s.sol and were not checked
///      against the chain again for this contract.
contract DeployFavourCampaignEscrow is Script {
    /// USDC on World Chain mainnet (chain id 480), as used by DeployFavourEscrowV2_1.
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    /// Canonical Permit2, as used by DeployFavourEscrowV2_1.
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        vm.startBroadcast();
        FavourCampaignEscrow escrow =
            new FavourCampaignEscrow(IERC20(USDC), IPermit2AllowanceTransfer(PERMIT2));
        vm.stopBroadcast();

        console.log("FavourCampaignEscrow:", address(escrow));
    }
}
