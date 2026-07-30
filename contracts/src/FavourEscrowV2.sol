// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FavourEscrowV2 — immutable, task-bound USDC escrow for FAVOUR (World Chain)
/// @notice One escrow per task id. Funds bind to a specific recipient at fund time and
///         can only ever move to that recipient (release) or back to the funder (refund
///         after expiry). There is no owner, no admin, no fee, no pause, no upgrade path,
///         and no function that accepts a destination address after funding.
///
/// @dev Design constraints (escrow-v2-design.md — the five sins of the retired
///      0x274C38eA9944f57D24A59fbEf558bba2264f9351 proxy, each excluded here):
///        1. Source is published + verified on the explorer before any third-party cent.
///        2. No hot-wallet owner: there is no owner at all. Deployer has zero powers.
///        3. No proxy / upgradeability: plain immutable contract, `USDC` is immutable.
///        4. Demand-gated at the product layer; the contract holds no policy.
///        5. Nothing here can trigger a listing rejection for unverifiable custody.
contract FavourEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The only token this contract will ever hold intentionally.
    IERC20 public immutable USDC;

    /// @notice Hard cap on how far in the future a deadline may sit, so a fat-fingered
    ///         deadline cannot delay the refund exit indefinitely.
    uint256 public constant MAX_DURATION = 180 days;

    enum Status {
        None, // never funded
        Funded, // USDC held, exits: release (funder) or refund (anyone, post-deadline)
        Released, // paid to the bound recipient — terminal
        Refunded // returned to the funder — terminal
    }

    struct Escrow {
        address funder; // who paid in; the only address refunds can go to
        address recipient; // bound at fund time; the only address release can go to
        uint96 amount; // USDC, 6 decimals (max ~7.9e28 — far above any real bounty)
        uint64 deadline; // unix seconds; refund becomes possible strictly after this
        Status status;
    }

    /// @notice taskId (e.g. keccak256 of the app task id) => escrow record.
    mapping(bytes32 => Escrow) public escrows;

    event Funded(
        bytes32 indexed taskId,
        address indexed funder,
        address indexed recipient,
        uint256 amount,
        uint64 deadline
    );
    event Released(bytes32 indexed taskId, address indexed recipient, uint256 amount);
    event Refunded(bytes32 indexed taskId, address indexed funder, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error DeadlineInvalid();
    error TaskAlreadyFunded();
    error TaskNotFunded();
    error NotFunder();
    error NotExpired();

    constructor(IERC20 usdc) {
        if (address(usdc) == address(0)) revert ZeroAddress();
        USDC = usdc;
    }

    /// @notice Fund a task. Binds `recipient` and `amount` to `taskId` forever.
    /// @dev Pulls `amount` USDC from msg.sender (requires prior approval). The funder is
    ///      always msg.sender — there is deliberately no `from` parameter, so nobody can
    ///      spend a third party's allowance to this contract.
    function fund(bytes32 taskId, address recipient, uint96 amount, uint64 deadline)
        external
        nonReentrant
    {
        if (escrows[taskId].status != Status.None) revert TaskAlreadyFunded();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) {
            revert DeadlineInvalid();
        }

        escrows[taskId] = Escrow({
            funder: msg.sender,
            recipient: recipient,
            amount: amount,
            deadline: deadline,
            status: Status.Funded
        });

        emit Funded(taskId, msg.sender, recipient, amount, deadline);

        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Pay the bound recipient. Only the funder can call; the destination and
    ///         amount are the ones fixed at fund time. Works before or after the
    ///         deadline (late completion is the funder's call).
    function release(bytes32 taskId) external nonReentrant {
        Escrow storage e = escrows[taskId];
        if (e.status != Status.Funded) revert TaskNotFunded();
        if (msg.sender != e.funder) revert NotFunder();

        e.status = Status.Released;
        emit Released(taskId, e.recipient, e.amount);

        USDC.safeTransfer(e.recipient, e.amount);
    }

    /// @notice Return funds to the funder after the deadline has passed. Callable by
    ///         anyone (e.g. an ops cron): the destination is always the bound funder,
    ///         so opening the trigger surface moves no value to the caller.
    function refund(bytes32 taskId) external nonReentrant {
        Escrow storage e = escrows[taskId];
        if (e.status != Status.Funded) revert TaskNotFunded();
        if (block.timestamp <= e.deadline) revert NotExpired();

        e.status = Status.Refunded;
        emit Refunded(taskId, e.funder, e.amount);

        USDC.safeTransfer(e.funder, e.amount);
    }

    /// @notice Full escrow record for a task.
    function getEscrow(bytes32 taskId) external view returns (Escrow memory) {
        return escrows[taskId];
    }
}
