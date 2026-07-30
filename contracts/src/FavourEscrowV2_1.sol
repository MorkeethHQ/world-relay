// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The two Permit2 AllowanceTransfer entry points this contract relies on.
///      Canonical deployment (all chains incl. World Chain 480):
///      0x000000000022D473030F116dDEE9F6B43aC78BA3
interface IPermit2AllowanceTransfer {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @title FavourEscrowV2_1 — immutable, task-bound USDC escrow for FAVOUR (World Chain)
/// @notice Identical guarantees to FavourEscrowV2 (one escrow per task id; funds bind to
///         a recipient at fund time; exits are release-by-funder or refund-to-funder
///         after expiry; no owner, no admin, no fee, no pause, no upgrade path) PLUS a
///         Permit2 AllowanceTransfer fund path, because World App mini apps move tokens
///         through Permit2 ("Allowance transfers are the recommended method for moving
///         tokens in mini apps" — docs.world.org/mini-apps/commands/send-transaction).
///
/// @dev The client batches [permit2.approve(USDC, escrow, amount, 0), fundWithPermit2(...)]
///      in one MiniKit sendTransaction; expiration 0 makes the Permit2 allowance valid
///      only within the same block, so nothing durable is left behind. World App
///      auto-approves USDC to Permit2 at the token level. Plain fund() is kept for
///      EOAs, tests, and server self-tests — both paths write the identical record.
contract FavourEscrowV2_1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The only token this contract will ever hold intentionally.
    IERC20 public immutable USDC;

    /// @notice Canonical Permit2. Immutable; the contract only ever calls transferFrom
    ///         with `to = address(this)`, so Permit2 can never route funds elsewhere.
    IPermit2AllowanceTransfer public immutable PERMIT2;

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

    constructor(IERC20 usdc, IPermit2AllowanceTransfer permit2) {
        if (address(usdc) == address(0)) revert ZeroAddress();
        if (address(permit2) == address(0)) revert ZeroAddress();
        USDC = usdc;
        PERMIT2 = permit2;
    }

    /// @dev Shared validation + state write + event for both fund paths. The funder is
    ///      always msg.sender — there is deliberately no `from` parameter on either
    ///      entry point, so nobody can spend a third party's allowance to this contract
    ///      (token-level OR Permit2-level).
    function _recordFunding(bytes32 taskId, address recipient, uint96 amount, uint64 deadline)
        private
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
    }

    /// @notice Fund a task via a direct ERC-20 allowance. Binds `recipient` and `amount`
    ///         to `taskId` forever. Requires prior USDC.approve(escrow, amount).
    function fund(bytes32 taskId, address recipient, uint96 amount, uint64 deadline)
        external
        nonReentrant
    {
        _recordFunding(taskId, recipient, amount, deadline);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Fund a task via a Permit2 AllowanceTransfer. Same record, same
    ///         guarantees as fund(); only the pull mechanism differs. Requires the
    ///         caller to have granted a Permit2 allowance (token = USDC, spender =
    ///         this contract, amount >= `amount`, unexpired) — in World App this is
    ///         the permit2.approve(...) call batched immediately before this one.
    function fundWithPermit2(bytes32 taskId, address recipient, uint96 amount, uint64 deadline)
        external
        nonReentrant
    {
        _recordFunding(taskId, recipient, amount, deadline);
        // Pull is pinned: from = msg.sender, to = this, token = USDC. A malicious or
        // mismatched permit cannot redirect the deposit — Permit2 reverts instead.
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), address(USDC));
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
