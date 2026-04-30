// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/RelayAgentEscrowV2.sol";

contract DeployV2 is Script {
    // World Chain USDC
    address constant USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy implementation
        RelayAgentEscrowV2 impl = new RelayAgentEscrowV2();

        // 2. Deploy proxy with initialize call
        // relayer = deployer (can change later), feeRecipient = deployer
        bytes memory initData = abi.encodeWithSelector(
            RelayAgentEscrowV2.initialize.selector,
            USDC,
            deployer, // relayer
            deployer  // fee recipient
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);

        vm.stopBroadcast();

        console.log("Implementation:", address(impl));
        console.log("Proxy (use this):", address(proxy));
        console.log("Owner/Relayer/FeeRecipient:", deployer);
    }
}
