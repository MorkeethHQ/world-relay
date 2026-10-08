// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FavourReviewEscrow} from "../src/FavourReviewEscrow.sol";
import {IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys FavourReviewEscrow. No proxy and no initializer.
/// @dev NOT RUN. Written and compiled only. Deploying, verifying the source on the
///      explorer and turning intake on are Oscar's click.
///      The admin and the releaser come from the environment on purpose: the admin
///      must be a cold wallet or a multisig, and must not be the relayer hot wallet.
///      The repo's CLAUDE.md records what went wrong when the key that pays out was
///      also the key that owns the contract. Both token addresses are copied from
///      DeployFavourEscrowV2_1.s.sol and were not checked on chain again.
contract DeployFavourReviewEscrow is Script {
    /// USDC on World Chain mainnet (chain id 480), as used by DeployFavourEscrowV2_1.
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    /// Canonical Permit2, as used by DeployFavourEscrowV2_1.
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        address admin = vm.envAddress("REVIEW_ESCROW_ADMIN");
        address releaser = vm.envAddress("REVIEW_ESCROW_RELEASER");
        require(admin != releaser, "admin and releaser must be different keys");

        vm.startBroadcast();
        FavourReviewEscrow escrow = new FavourReviewEscrow(
            IERC20(USDC), IPermit2AllowanceTransfer(PERMIT2), admin, releaser
        );
        vm.stopBroadcast();

        console.log("FavourReviewEscrow:", address(escrow));
    }
}
