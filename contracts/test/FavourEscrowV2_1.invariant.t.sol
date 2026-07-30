// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FavourEscrowV2_1, IPermit2AllowanceTransfer} from "../src/FavourEscrowV2_1.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";

/// @dev Random sequences of fund/fundWithPermit2/release/refund/warp across actors.
///      Same ghost accounting as the V2 invariant suite; the Permit2 path must
///      uphold the identical conservation properties as the direct path.
contract EscrowHandlerV2_1 is Test {
    FavourEscrowV2_1 public escrow;
    MockUSDC public usdc;
    MockPermit2 public permit2;

    address[] public actors;
    bytes32[] public liveTasks; // funded, not yet exited
    uint256 public ghostHeld; // sum of amounts in Funded status
    uint256 public ghostReleased;
    uint256 public ghostRefunded;
    uint256 public taskNonce;

    constructor(FavourEscrowV2_1 _escrow, MockUSDC _usdc, MockPermit2 _permit2) {
        escrow = _escrow;
        usdc = _usdc;
        permit2 = _permit2;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            usdc.mint(a, 1_000_000_000); // 1000 USDC each
            vm.startPrank(a);
            usdc.approve(address(escrow), type(uint256).max);
            usdc.approve(address(permit2), type(uint256).max); // World App auto-approval
            vm.stopPrank();
        }
    }

    function fund(
        uint256 actorSeed,
        uint256 recipientSeed,
        uint96 amount,
        uint64 duration,
        bool viaPermit2
    ) external {
        address funder = actors[actorSeed % actors.length];
        address recipient = actors[recipientSeed % actors.length];
        amount = uint96(bound(amount, 1, 50_000_000));
        duration = uint64(bound(duration, 1, 180 days));
        if (usdc.balanceOf(funder) < amount) return;

        bytes32 id = keccak256(abi.encode("task", taskNonce++));
        if (viaPermit2) {
            vm.startPrank(funder);
            permit2.approve(address(usdc), address(escrow), amount, 0);
            escrow.fundWithPermit2(id, recipient, amount, uint64(block.timestamp) + duration);
            vm.stopPrank();
        } else {
            vm.prank(funder);
            escrow.fund(id, recipient, amount, uint64(block.timestamp) + duration);
        }

        liveTasks.push(id);
        ghostHeld += amount;
    }

    function release(uint256 taskSeed) external {
        if (liveTasks.length == 0) return;
        uint256 idx = taskSeed % liveTasks.length;
        bytes32 id = liveTasks[idx];
        FavourEscrowV2_1.Escrow memory e = escrow.getEscrow(id);
        if (e.status != FavourEscrowV2_1.Status.Funded) return;

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
        FavourEscrowV2_1.Escrow memory e = escrow.getEscrow(id);
        if (e.status != FavourEscrowV2_1.Status.Funded) return;
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

contract FavourEscrowV2_1InvariantTest is StdInvariant, Test {
    FavourEscrowV2_1 internal escrow;
    MockUSDC internal usdc;
    MockPermit2 internal permit2;
    EscrowHandlerV2_1 internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
        escrow = new FavourEscrowV2_1(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2))
        );
        handler = new EscrowHandlerV2_1(escrow, usdc, permit2);
        targetContract(address(handler));
    }

    /// The contract's balance always exactly equals the sum of open (Funded) escrows.
    function invariant_balance_matches_open_escrows() public view {
        assertEq(usdc.balanceOf(address(escrow)), handler.ghostHeld());
    }

    /// Conservation: everything ever pulled in is either still held, paid to a bound
    /// recipient, or returned to its funder — regardless of which fund path pulled it.
    function invariant_value_conserved() public view {
        uint256 pulledIn = handler.ghostHeld() + handler.ghostReleased() + handler.ghostRefunded();
        uint256 accounted =
            usdc.balanceOf(address(escrow)) + handler.ghostReleased() + handler.ghostRefunded();
        assertEq(pulledIn, accounted);
    }
}
