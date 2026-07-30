// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FavourEscrowV2} from "../src/FavourEscrowV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Random sequences of fund/release/refund/warp across several actors.
///      Ghost accounting tracks what SHOULD be held; invariants assert the
///      contract can never hold less than the sum of open escrows and that
///      no value is ever minted or lost by the escrow itself.
contract EscrowHandler is Test {
    FavourEscrowV2 public escrow;
    MockUSDC public usdc;

    address[] public actors;
    bytes32[] public liveTasks; // funded, not yet exited
    uint256 public ghostHeld; // sum of amounts in Funded status
    uint256 public ghostReleased;
    uint256 public ghostRefunded;
    uint256 public taskNonce;

    constructor(FavourEscrowV2 _escrow, MockUSDC _usdc) {
        escrow = _escrow;
        usdc = _usdc;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            usdc.mint(a, 1_000_000_000); // 1000 USDC each
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function fund(uint256 actorSeed, uint256 recipientSeed, uint96 amount, uint64 duration)
        external
    {
        address funder = actors[actorSeed % actors.length];
        address recipient = actors[recipientSeed % actors.length];
        amount = uint96(bound(amount, 1, 50_000_000));
        duration = uint64(bound(duration, 1, 180 days));
        if (usdc.balanceOf(funder) < amount) return;

        bytes32 id = keccak256(abi.encode("task", taskNonce++));
        vm.prank(funder);
        escrow.fund(id, recipient, amount, uint64(block.timestamp) + duration);

        liveTasks.push(id);
        ghostHeld += amount;
    }

    function release(uint256 taskSeed) external {
        if (liveTasks.length == 0) return;
        uint256 idx = taskSeed % liveTasks.length;
        bytes32 id = liveTasks[idx];
        FavourEscrowV2.Escrow memory e = escrow.getEscrow(id);
        if (e.status != FavourEscrowV2.Status.Funded) return;

        vm.prank(e.funder);
        escrow.release(id);

        ghostHeld -= e.amount;
        ghostReleased += e.amount;
        liveTasks[idx] = liveTasks[liveTasks.length - 1];
        liveTasks.pop();
    }

    function refund(uint256 taskSeed) external {
        if (liveTasks.length == 0) return;
        uint256 idx = taskSeed % liveTasks.length;
        bytes32 id = liveTasks[idx];
        FavourEscrowV2.Escrow memory e = escrow.getEscrow(id);
        if (e.status != FavourEscrowV2.Status.Funded) return;
        if (block.timestamp <= e.deadline) return;

        escrow.refund(id); // caller irrelevant by design

        ghostHeld -= e.amount;
        ghostRefunded += e.amount;
        liveTasks[idx] = liveTasks[liveTasks.length - 1];
        liveTasks.pop();
    }

    function warp(uint64 by) external {
        vm.warp(block.timestamp + bound(by, 1, 30 days));
    }
}

contract FavourEscrowV2InvariantTest is StdInvariant, Test {
    FavourEscrowV2 internal escrow;
    MockUSDC internal usdc;
    EscrowHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new FavourEscrowV2(IERC20(address(usdc)));
        handler = new EscrowHandler(escrow, usdc);
        targetContract(address(handler));
    }

    /// The contract's balance always exactly equals the sum of open (Funded) escrows.
    /// (Exact equality holds because nothing else sends USDC to it in this harness;
    /// on mainnet a donation could only push balance ABOVE the ghost sum, never below.)
    function invariant_balance_matches_open_escrows() public view {
        assertEq(usdc.balanceOf(address(escrow)), handler.ghostHeld());
    }

    /// Conservation: everything ever pulled in is either still held, paid to a bound
    /// recipient, or returned to its funder. The escrow neither mints nor burns value.
    function invariant_value_conserved() public view {
        uint256 pulledIn = handler.ghostHeld() + handler.ghostReleased() + handler.ghostRefunded();
        uint256 accounted =
            usdc.balanceOf(address(escrow)) + handler.ghostReleased() + handler.ghostRefunded();
        assertEq(pulledIn, accounted);
    }
}
