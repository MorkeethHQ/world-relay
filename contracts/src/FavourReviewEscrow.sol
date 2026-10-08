// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPermit2AllowanceTransfer} from "./FavourCampaignEscrow.sol";

/// @title FavourReviewEscrow: a review budget that the FAVOUR checker releases
/// @notice Anyone deposits into a campaign: the maker, the admin, an agent or any
///         wallet. FAVOUR's checker judges each review off chain. When a review
///         passes, the releaser credits the reward to the reviewer. The reviewer
///         withdraws it. What is not released goes back to the depositors, each
///         in proportion to what they put in.
///
///         This contract follows Oscar's rulings of 8 Oct 2026:
///         - "both Admin, i.e me can deposit, or peoples agents, or individuals from
///           the wallet, it should just be an escrow address thats released to the
///           individual performing the favour"
///         - "it should automatically bre reviewed by our AI ... then it released",
///           with admin review as the fallback
///         - "if nothing is completed, you get a return or can claw back"
///         - "let's not do fees yet, not on deposit, but take it on withdrawals"
///         - "I DONT HATE CUSTODY"
///         It replaces the funder-only release of FavourCampaignEscrow, which stays
///         in the tree for comparison.
///
///         What the contract guarantees:
///         1. The budget is a hard cap. For every campaign, at every moment,
///            deposited == released + remaining while it is open, and
///            deposited == released + refundable once it is closed.
///         2. One contribution id is released at most once inside its campaign.
///         3. Money leaves in two ways only: withdraw (to the reviewer it was
///            credited to, less the fee) and claimRefund (to the depositor, their
///            share of what was not released). The caller of either gains nothing.
///         4. One campaign can never spend another campaign's money.
///         5. A deposit is never charged a fee. The fee is taken on withdrawal, it
///            starts at zero, and it can never be set above MAX_FEE_BPS.
///         6. No proxy, no initializer, no upgrade path, no delegatecall, no
///            arbitrary call, no pause.
///
///         What the contract does NOT do, stated as plainly as the guarantees:
///         - It trusts two keys. The RELEASER can credit any campaign's remaining
///           budget to any address. The ADMIN can do the same, can replace the
///           releaser, can set the fee up to the cap, and can close a campaign
///           early. A stolen releaser or admin key can drain every open budget.
///           That is custody, and it is accepted by ruling. The limit on the damage
///           is the sum of open budgets; money already credited to a reviewer or
///           already refundable cannot be moved by either key.
///         - It does not judge reviews. Whether a review is real and deserved is
///           decided off chain. The Released event is the public record of it.
///         - A release cannot be reversed. A wrong release is paid back by hand.
///
/// @dev OPEN, for Oscar. Values chosen to ship a testable contract:
///      - REFUND_GRACE 72 hours, MAX_FEE_BPS 1000 (10%), MAX_BATCH 100.
///      - No hold between release and withdrawal. A hold with an admin veto would
///        limit a stolen releaser key and is the first hardening to consider.
///      - Where the releaser key lives, and who the admin is.
///      - MAX_BATCH was not checked against the World Chain block gas limit.
///
///      Campaign ids are keccak256(abi.encode(creator, salt)) with creator always
///      msg.sender, so nobody can take an id a maker's app already announced.
///      Contribution ids are scoped per campaign.
///
///      Refund shares. A depositor's share is deposits * refundable / deposited,
///      rounded down. The few base units lost to rounding stay in the contract.
///      No function can move them.
///
///      Token limits. The token must have no transfer fee and no rebase. Tokens
///      sent here outside create or deposit are stranded. If the token blocks a
///      reviewer or a depositor, that address's withdraw or refund reverts and the
///      money waits; nobody else's money is affected, because both exits are
///      per address.
contract FavourReviewEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The only token this contract holds on purpose. Another token means
    ///         another deployment.
    IERC20 public immutable TOKEN;

    /// @notice Canonical Permit2. Only ever called with from = msg.sender and
    ///         to = address(this).
    IPermit2AllowanceTransfer public immutable PERMIT2;

    uint256 public constant MAX_DURATION = 180 days;
    uint256 public constant REFUND_GRACE = 72 hours;
    uint256 public constant MAX_BATCH = 100;
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 private constant BPS = 10_000;

    /// @notice Can replace the releaser, set the fee, release by hand and close a
    ///         campaign early. Changed in two steps.
    address public admin;
    address public pendingAdmin;

    /// @notice The checker's key. Can release and nothing else.
    address public releaser;

    /// @notice Fee on withdrawal, in basis points. Starts at zero.
    uint256 public feeBps;
    address public feeRecipient;

    enum Status {
        None,
        Open, // deposits before the deadline, releases at any time
        Closed // nothing more is released. Depositors claim their share.
    }

    struct Campaign {
        address creator; // who opened it. May close it early only while nothing is released.
        uint64 deadline; // unix seconds. No deposit from this moment on.
        Status status;
        uint96 deposited; // total ever put in, by everyone
        uint96 released; // total credited to reviewers
        uint96 remaining; // still releasable while Open
        uint96 refundable; // set once at close: what the depositors share
    }

    mapping(bytes32 => Campaign) public campaigns;

    /// @notice campaignId => depositor => total that address put in.
    mapping(bytes32 => mapping(address => uint96)) public deposits;

    /// @notice campaignId => depositor => true once their refund share was sent.
    mapping(bytes32 => mapping(address => bool)) public refundClaimed;

    /// @notice campaignId => contributionId => true once released.
    mapping(bytes32 => mapping(bytes32 => bool)) public isReleased;

    /// @notice What each reviewer can withdraw now, before the fee.
    mapping(address => uint256) public earned;

    /// @notice Sum of every `earned` balance.
    uint256 public totalEarned;

    event Created(bytes32 indexed campaignId, address indexed creator, bytes32 salt, uint64 deadline);
    event Deposited(
        bytes32 indexed campaignId, address indexed depositor, uint256 amount, uint256 remaining
    );
    event Released(
        bytes32 indexed campaignId,
        bytes32 indexed contributionId,
        address indexed recipient,
        uint256 amount,
        address by
    );
    event Withdrawn(address indexed recipient, uint256 paid, uint256 fee);
    event Closed(bytes32 indexed campaignId, uint256 refundable, address by);
    event RefundClaimed(bytes32 indexed campaignId, address indexed depositor, uint256 amount);
    event ReleaserChanged(address indexed from, address indexed to);
    event AdminProposed(address indexed admin, address indexed pending);
    event AdminChanged(address indexed from, address indexed to);
    event FeeChanged(uint256 feeBps, address indexed feeRecipient);

    error ZeroAddress();
    error ZeroAmount();
    error DeadlineInvalid();
    error CampaignExists();
    error CampaignNotOpen();
    error CampaignNotClosed();
    error CampaignEnded();
    error NotAdmin();
    error NotPendingAdmin();
    error NotReleaser();
    error NotClosableYet();
    error EmptyBatch();
    error BatchTooLarge();
    error LengthMismatch();
    error InvalidRecipient();
    error BudgetExceeded();
    error AlreadyReleased();
    error NothingToWithdraw();
    error NothingToRefund();
    error RefundAlreadyClaimed();
    error FeeTooHigh();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        IERC20 token,
        IPermit2AllowanceTransfer permit2,
        address admin_,
        address releaser_
    ) {
        if (address(token) == address(0) || address(permit2) == address(0)) revert ZeroAddress();
        if (admin_ == address(0) || releaser_ == address(0)) revert ZeroAddress();
        TOKEN = token;
        PERMIT2 = permit2;
        admin = admin_;
        releaser = releaser_;
        feeRecipient = admin_;
        emit AdminChanged(address(0), admin_);
        emit ReleaserChanged(address(0), releaser_);
    }

    function campaignIdOf(address creator, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(creator, salt));
    }

    // ---------------------------------------------------------------- roles

    function proposeAdmin(address next) external onlyAdmin {
        pendingAdmin = next;
        emit AdminProposed(admin, next);
    }

    /// @notice The proposed admin takes the role. Two steps, so a mistyped address
    ///         cannot lock the role away.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        emit AdminChanged(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }

    function setReleaser(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        emit ReleaserChanged(releaser, next);
        releaser = next;
    }

    /// @notice Set the withdrawal fee. It applies to withdrawals made after this
    ///         call, including money earned before it.
    function setFee(uint256 feeBps_, address feeRecipient_) external onlyAdmin {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeChanged(feeBps_, feeRecipient_);
    }

    // ---------------------------------------------------------------- fund

    function _recordCreate(bytes32 salt, uint96 amount, uint64 deadline)
        private
        returns (bytes32 campaignId)
    {
        campaignId = campaignIdOf(msg.sender, salt);
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.None) revert CampaignExists();
        if (amount == 0) revert ZeroAmount();
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) {
            revert DeadlineInvalid();
        }
        c.creator = msg.sender;
        c.deadline = deadline;
        c.status = Status.Open;
        emit Created(campaignId, msg.sender, salt, deadline);
        _recordDeposit(campaignId, c, amount);
    }

    /// @dev The depositor is always msg.sender. No entry point takes a `from`, so
    ///      nobody can spend another address's allowance to this contract.
    function _recordDeposit(bytes32 campaignId, Campaign storage c, uint96 amount) private {
        if (c.status != Status.Open) revert CampaignNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (amount == 0) revert ZeroAmount();
        c.deposited += amount;
        c.remaining += amount;
        deposits[campaignId][msg.sender] += amount;
        emit Deposited(campaignId, msg.sender, amount, c.remaining);
    }

    /// @notice Open a campaign and make the first deposit, with an ERC-20 allowance.
    function create(bytes32 salt, uint96 amount, uint64 deadline)
        external
        nonReentrant
        returns (bytes32 campaignId)
    {
        campaignId = _recordCreate(salt, amount, deadline);
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice The same with a Permit2 AllowanceTransfer, the path World App uses.
    function createWithPermit2(bytes32 salt, uint96 amount, uint64 deadline)
        external
        nonReentrant
        returns (bytes32 campaignId)
    {
        campaignId = _recordCreate(salt, amount, deadline);
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), address(TOKEN));
    }

    /// @notice Add money to any open campaign before its deadline. Anyone may: the
    ///         maker, the admin, an agent, a friend. Each depositor's total is kept,
    ///         and a refund goes back to each in proportion.
    function deposit(bytes32 campaignId, uint96 amount) external nonReentrant {
        _recordDeposit(campaignId, campaigns[campaignId], amount);
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    }

    function depositWithPermit2(bytes32 campaignId, uint96 amount) external nonReentrant {
        _recordDeposit(campaignId, campaigns[campaignId], amount);
        PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), address(TOKEN));
    }

    // ---------------------------------------------------------------- release

    /// @notice Credit rewards for reviews that passed the check. Releaser or admin
    ///         only. Item i credits amounts[i] to recipients[i] for
    ///         contributionIds[i]. No token moves here: the reviewer withdraws.
    ///         If any item fails, the whole batch reverts.
    function release(
        bytes32 campaignId,
        bytes32[] calldata contributionIds,
        address[] calldata recipients,
        uint96[] calldata amounts
    ) external nonReentrant {
        if (msg.sender != releaser && msg.sender != admin) revert NotReleaser();
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Open) revert CampaignNotOpen();

        uint256 n = contributionIds.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge();
        if (recipients.length != n || amounts.length != n) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            _creditOne(campaignId, contributionIds[i], recipients[i], amounts[i]);
            total += amounts[i];
        }
        if (total > c.remaining) revert BudgetExceeded();
        // total <= remaining <= type(uint96).max, so the casts cannot truncate.
        c.remaining -= uint96(total);
        c.released += uint96(total);
        totalEarned += total;
    }

    /// @dev One item of a batch. The id is marked first, so a duplicate inside one
    ///      batch reverts the whole batch.
    function _creditOne(bytes32 campaignId, bytes32 contributionId, address recipient, uint96 amount)
        private
    {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (isReleased[campaignId][contributionId]) revert AlreadyReleased();
        isReleased[campaignId][contributionId] = true;
        earned[recipient] += amount;
        emit Released(campaignId, contributionId, recipient, amount, msg.sender);
    }

    /// @notice Send `recipient` everything they have earned, less the fee. Anyone
    ///         may call, for example a cron, so a reviewer needs no gas. The money
    ///         goes to the recipient and the fee to the fee recipient, nowhere else.
    function withdraw(address recipient) external nonReentrant {
        uint256 amount = earned[recipient];
        if (amount == 0) revert NothingToWithdraw();

        earned[recipient] = 0;
        totalEarned -= amount;
        uint256 fee = amount * feeBps / BPS;
        uint256 paid = amount - fee;
        emit Withdrawn(recipient, paid, fee);

        if (fee > 0) TOKEN.safeTransfer(feeRecipient, fee);
        TOKEN.safeTransfer(recipient, paid);
    }

    // ---------------------------------------------------------------- close and refund

    /// @notice Stop releases and fix what the depositors share.
    ///         - Anyone, after the deadline plus REFUND_GRACE.
    ///         - The admin, at any time.
    ///         - The creator, at any time, but only while nothing was released:
    ///           "if nothing is completed, you get a return or can claw back".
    function close(bytes32 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Open) revert CampaignNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        bool late = block.timestamp > uint256(c.deadline) + REFUND_GRACE;
        bool clawBack = msg.sender == c.creator && c.released == 0;
        if (!late && msg.sender != admin && !clawBack) revert NotClosableYet();

        c.refundable = c.remaining;
        c.remaining = 0;
        c.status = Status.Closed;
        emit Closed(campaignId, c.refundable, msg.sender);
    }

    /// @notice What `depositor` gets back from a closed campaign.
    function refundShare(bytes32 campaignId, address depositor) public view returns (uint256) {
        Campaign storage c = campaigns[campaignId];
        if (c.status != Status.Closed || c.deposited == 0) return 0;
        if (refundClaimed[campaignId][depositor]) return 0;
        return uint256(deposits[campaignId][depositor]) * c.refundable / c.deposited;
    }

    /// @notice Send `depositor` their share of a closed campaign. Anyone may call;
    ///         the money goes to the depositor and nowhere else.
    function claimRefund(bytes32 campaignId, address depositor) external nonReentrant {
        if (campaigns[campaignId].status != Status.Closed) revert CampaignNotClosed();
        if (refundClaimed[campaignId][depositor]) revert RefundAlreadyClaimed();
        uint256 amount = refundShare(campaignId, depositor);
        if (amount == 0) revert NothingToRefund();

        refundClaimed[campaignId][depositor] = true;
        emit RefundClaimed(campaignId, depositor, amount);
        TOKEN.safeTransfer(depositor, amount);
    }

    function getCampaign(bytes32 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }
}
