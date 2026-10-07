// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The one Permit2 AllowanceTransfer entry point this contract relies on.
///      Canonical deployment (all chains incl. World Chain 480):
///      0x000000000022D473030F116dDEE9F6B43aC78BA3
interface IPermit2AllowanceTransfer {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @title FavourCampaignEscrow: a review budget that nobody but its funder can spend
/// @notice A maker deposits a USDC budget for one campaign. The maker pays reviewers
///         out of that budget, one contribution at a time, in batches. After the
///         deadline plus a grace period, anyone can send what is left back to the
///         maker. That is the whole mechanism.
///
///         What the contract guarantees:
///         1. The budget is a hard cap. For every campaign, at every moment,
///            deposited == paid + refunded + remaining.
///         2. One contribution id is paid at most once inside its campaign.
///         3. Money leaves in two ways only: payBatch (funder only, to the
///            recipients the funder names) and refund (anyone, after the deadline
///            plus REFUND_GRACE, to the stored funder and nowhere else).
///         4. One campaign can never spend another campaign's money.
///         5. There is no owner, no admin, no pause, no fee, no proxy, no
///            initializer and no upgrade path. The deployer has no power after
///            deployment. The contract makes no delegatecall and no arbitrary call.
///
///         What the contract does NOT do. It protects the funder and it shows the
///         budget in public. It does not judge reviews. A reviewer has no claim on
///         chain: a maker can decline to pay anyone and take the whole remainder
///         back after the deadline. Whether a review earned its payout is decided
///         off chain, and the per-item Paid event is the public record of it.
///
/// @dev OPEN, for Oscar to rule. These are choices made to ship a testable contract,
///      not settled decisions:
///      - Release authority is funder only. Reason: any arbiter or relayer key would
///        put a hot key in control of other people's money. The cost is that a maker
///        can refuse every reviewer. No ruling exists on this yet.
///      - REFUND_GRACE is 72 hours, to match the confirm grace the app already uses
///        for the per-task escrow. The value is a suggestion.
///      - There is no fee logic of any kind. The fee model is an open decision.
///      - A signed batch path (EIP-712, so a relayer can submit a batch the funder
///        signed) is left out. It needs a nonce, a signature deadline and its own
///        tests.
///
///      Campaign ids. The id is keccak256(abi.encode(funder, salt)), with the funder
///      always msg.sender. A caller-chosen global id would let a stranger watch the
///      mempool and create a campaign on an id the maker's app had already announced.
///      Scoping the id to the funder removes that: nobody else can produce your id.
///
///      Contribution ids are scoped PER CAMPAIGN, not globally. With a global map an
///      attacker could create a throwaway campaign, pay a victim's contribution id
///      with dust, and so block the real maker from ever paying that reviewer. Here
///      the paid flag lives under the campaign id, so only that campaign's funder can
///      set it.
///
///      Timing. topUp works only before the deadline. payBatch works for as long as
///      the campaign is Active, which includes the time after the deadline and after
///      the grace period, until somebody calls refund. Late payment is the funder's
///      call, as in FavourEscrowV2_1. After deadline + REFUND_GRACE a refund call can
///      land before a late payBatch; the late payBatch then reverts and the money is
///      with the funder, who can pay the reviewer directly.
///
///      Known limits, stated so nobody has to discover them:
///      - USDC is assumed to have no transfer fee and no rebase. A token that takes a
///        fee on transfer would break the accounting.
///      - USDC sent straight to this contract, outside create or topUp, is stranded.
///        No function can move it. So the balance invariant is "at least" the sum of
///        remaining, not "exactly".
///      - USDC has a blocklist. One blocklisted recipient reverts the whole batch.
///        Nothing is marked paid in that case; the funder sends the batch again
///        without that recipient. If the funder itself is blocklisted, refund reverts
///        and the remainder stays here until the funder is cleared or pays it out.
///        Any other refund destination would be a controller, so there is none.
///      - Dust griefing. Anyone may create campaigns, with any amount above zero.
///        That costs only the creator and cannot touch another campaign.
///      - Batch gas. MAX_BATCH is 100 items. The World Chain block gas limit was not
///        checked against that number: unverified. A batch that runs out of gas
///        reverts whole and can be sent again in smaller pieces.
///      - Fund paths. World App mini apps move tokens through Permit2, so the client
///        is expected to batch [permit2.approve(USDC, this, amount, 0), then
///        createWithPermit2 or topUpWithPermit2] in one transaction. Whether MiniKit
///        does that for this contract is unverified. The plain ERC-20 paths are for
///        EOAs and tests. Both paths write the same record.
contract FavourCampaignEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The only token this contract will ever hold on purpose.
    IERC20 public immutable USDC;

    /// @notice Canonical Permit2. Immutable. The contract only ever calls
    ///         transferFrom with from = msg.sender and to = address(this), so
    ///         Permit2 can never route a deposit anywhere else.
    IPermit2AllowanceTransfer public immutable PERMIT2;

    /// @notice Hard cap on how far in the future a deadline may sit, so a mistyped
    ///         deadline cannot hold the remainder back for years.
    uint256 public constant MAX_DURATION = 180 days;

    /// @notice Time after the deadline during which only the funder can act. It
    ///         gives the funder room to pay reviews that arrived near the deadline.
    ///         OPEN: the value is a suggestion, see the header.
    uint256 public constant REFUND_GRACE = 72 hours;

    /// @notice Most items one payBatch call may carry. OPEN: not checked against the
    ///         World Chain block gas limit.
    uint256 public constant MAX_BATCH = 100;

    enum Status {
        None, // never created
        Active, // exits: payBatch (funder) and refund (anyone, after deadline + grace)
        Refunded // remainder returned to the funder. Terminal.
    }

    struct Campaign {
        address funder; // who paid in. The only address a refund can go to.
        uint96 deposited; // total USDC ever put in (create plus every top up)
        uint96 paid; // total USDC paid to reviewers
        uint96 refunded; // total USDC returned to the funder
        uint64 deadline; // unix seconds. No top up from this moment on.
        uint96 remaining; // USDC still spendable. Decremented before every transfer.
        Status status;
    }

    /// @notice campaignId => campaign record. See campaignIdOf for how ids are made.
    mapping(bytes32 => Campaign) public campaigns;

    /// @notice campaignId => contributionId => true once that contribution was paid.
    mapping(bytes32 => mapping(bytes32 => bool)) public isPaid;

    event Created(
        bytes32 indexed campaignId,
        address indexed funder,
        bytes32 salt,
        uint256 amount,
        uint64 deadline
    );
    event ToppedUp(
        bytes32 indexed campaignId, address indexed funder, uint256 amount, uint256 remaining
    );
    event Paid(
        bytes32 indexed campaignId,
        bytes32 indexed contributionId,
        address indexed recipient,
        uint256 amount
    );
    event Refunded(bytes32 indexed campaignId, address indexed funder, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error DeadlineInvalid();
    error CampaignExists();
    error CampaignNotActive();
    error CampaignEnded();
    error NotFunder();
    error NotRefundableYet();
    error NothingToRefund();
    error EmptyBatch();
    error BatchTooLarge();
    error LengthMismatch();
    error InvalidRecipient();
    error BudgetExceeded();
    error ContributionAlreadyPaid();

    constructor(IERC20 usdc, IPermit2AllowanceTransfer permit2) {
        if (address(usdc) == address(0)) revert ZeroAddress();
        if (address(permit2) == address(0)) revert ZeroAddress();
        USDC = usdc;
        PERMIT2 = permit2;
    }

    /// @notice The id a campaign created by `funder` with `salt` gets.
    function campaignIdOf(address funder, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(funder, salt));
    }

    // ---------------------------------------------------------------- fund

    /// @dev Shared checks, state write and event for both create paths. The funder
    ///      is always msg.sender. There is no `from` parameter on any entry point,
    ///      so nobody can spend a third party's allowance to this contract, at the
    ///      token level or at the Permit2 level.
    function _recordCreate(bytes32 salt, uint96 amount, uint64 deadline)
        private
        returns (bytes32 campaignId)
    {
        campaignId = campaignIdOf(msg.sender, salt);
        if (campaigns[campaignId].status != Status.None) revert CampaignExists();
        if (amount == 0) revert ZeroAmount();
        // Timestamps are compared on purpose. A few seconds of validator drift do not
        // matter against a deadline measured in days.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) {
            revert DeadlineInvalid();
        }

        campaigns[campaignId] = Campaign({
            funder: msg.sender,
            deposited: amount,
            paid: 0,
            refunded: 0,
            deadline: deadline,
            remaining: amount,
            status: Status.Active
        });

        emit Created(campaignId, msg.sender, salt, amount, deadline);
    }

    /// @dev Shared checks, state write and event for both top up paths. Same funder,
    ///      Active status, strictly before the deadline. The deadline never moves.
    function _recordTopUp(bytes32 campaignId, uint96 amount) private {
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Active) revert CampaignNotActive();
        if (msg.sender != c.funder) revert NotFunder();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (amount == 0) revert ZeroAmount();

        // Checked arithmetic: a total above the uint96 range reverts here.
        c.deposited += amount;
        c.remaining += amount;

        emit ToppedUp(campaignId, msg.sender, amount, c.remaining);
    }

    /// @notice Open a campaign with a direct ERC-20 allowance. Needs a prior
    ///         USDC.approve(this, amount). Returns the campaign id.
    function create(bytes32 salt, uint96 amount, uint64 deadline)
        external
        nonReentrant
        returns (bytes32 campaignId)
    {
        campaignId = _recordCreate(salt, amount, deadline);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Open a campaign with a Permit2 AllowanceTransfer. Same record and
    ///         same guarantees as create. Only the pull mechanism differs.
    function createWithPermit2(bytes32 salt, uint96 amount, uint64 deadline)
        external
        nonReentrant
        returns (bytes32 campaignId)
    {
        campaignId = _recordCreate(salt, amount, deadline);
        // The pull is pinned: from = msg.sender, to = this, token = USDC.
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), address(USDC));
    }

    /// @notice Add budget to your own campaign before its deadline, with a direct
    ///         ERC-20 allowance.
    function topUp(bytes32 campaignId, uint96 amount) external nonReentrant {
        _recordTopUp(campaignId, amount);
        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Add budget to your own campaign before its deadline, with a Permit2
    ///         AllowanceTransfer.
    function topUpWithPermit2(bytes32 campaignId, uint96 amount) external nonReentrant {
        _recordTopUp(campaignId, amount);
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), address(USDC));
    }

    // ---------------------------------------------------------------- exits

    /// @notice Pay reviewers from the campaign budget. Funder only. Item i pays
    ///         amounts[i] to recipients[i] for contributionIds[i]. A contribution id
    ///         can be paid once per campaign. If any item fails, the whole batch
    ///         reverts and nothing is marked paid.
    function payBatch(
        bytes32 campaignId,
        bytes32[] calldata contributionIds,
        address[] calldata recipients,
        uint96[] calldata amounts
    ) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Active) revert CampaignNotActive();
        if (msg.sender != c.funder) revert NotFunder();

        uint256 n = contributionIds.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (recipients.length != n || amounts.length != n) revert LengthMismatch();

        // Sum in uint256. At most MAX_BATCH items of at most uint96 each, so the
        // sum cannot overflow. The whole batch is checked against the budget before
        // any state changes or any transfer.
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            total += amounts[i];
        }
        if (total > c.remaining) revert BudgetExceeded();

        for (uint256 i = 0; i < n; i++) {
            _payOne(campaignId, c, contributionIds[i], recipients[i], amounts[i]);
        }
    }

    /// @dev One item of a batch. State first, then the transfer. Marking the id
    ///      before the transfer also makes a duplicate inside one batch revert.
    function _payOne(
        bytes32 campaignId,
        Campaign storage c,
        bytes32 contributionId,
        address recipient,
        uint96 amount
    ) private {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (isPaid[campaignId][contributionId]) revert ContributionAlreadyPaid();

        isPaid[campaignId][contributionId] = true;
        c.remaining -= amount;
        c.paid += amount;
        emit Paid(campaignId, contributionId, recipient, amount);

        USDC.safeTransfer(recipient, amount);
    }

    /// @notice Return the unspent remainder to the funder. Anyone may call, for
    ///         example a cron. Works only after deadline + REFUND_GRACE. The
    ///         destination is always the stored funder, so the caller gains nothing.
    ///         The campaign is closed afterwards: no top up, no payBatch.
    function refund(bytes32 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Active) revert CampaignNotActive();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= uint256(c.deadline) + REFUND_GRACE) revert NotRefundableYet();

        uint96 amount = c.remaining;
        if (amount == 0) revert NothingToRefund();

        c.remaining = 0;
        c.refunded = amount;
        c.status = Status.Refunded;
        emit Refunded(campaignId, c.funder, amount);

        USDC.safeTransfer(c.funder, amount);
    }

    // ---------------------------------------------------------------- views

    /// @notice Full record for a campaign.
    function getCampaign(bytes32 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }
}
