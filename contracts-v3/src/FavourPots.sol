// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ManagedUpgradeable, IPermit2AllowanceTransfer} from "./ManagedUpgradeable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title FavourPots: FAVOUR v3 money (World Chain).
/// @notice Two ways to put money behind favours:
///  1. Campaign pots. Admin or operator opens a pot; anyone funds it; operator (the FAVOUR review key)
///     or admin pays a favour from it to a worker chosen at payout, at most the cap, each favour once.
///     Admin can freeze a pot (operator stops, admin can still pay) and close it; contributors then
///     claim back the unspent money pro rata.
///  2. Single favours. A user escrows one favour; the user, or a releaser the user named, releases it
///     to a worker chosen at release. After the deadline anyone can refund it, always to the user.
///     Admin can refund a user escrow early, only to that user; admin can never redirect it.
///  Fee (bps, capped at 10%) is taken on payouts only, never on deposits or refunds, and is copied
///  into each pot and escrow when it opens.
/// @dev Scope v2, KEPT by Oscar 2 Nov 2026. Makers opening their own pots is a later upgrade.
contract FavourPots is ManagedUpgradeable {
    uint256 public constant MAX_DURATION = 180 days;

    struct Campaign {
        address token;
        uint16 feeBps;
        bool closed;
        bool frozen;
        uint128 cap; // max per favour payout
        uint128 balance; // spendable while open
        uint128 totalFunded; // sum of all contributions, for pro rata refunds
        uint128 remainingAtClose; // unspent pot frozen at close
    }

    enum FavourStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Favour {
        address funder;
        uint64 deadline;
        uint16 feeBps;
        FavourStatus status;
        address releaser; // optional second key allowed to release (e.g. the review key)
        address token;
        uint128 amount;
    }

    /// @custom:storage-location erc7201:morkeeth.favourpots
    struct FavourStorage {
        uint256 campaignCount;
        mapping(uint256 => Campaign) campaigns;
        mapping(uint256 => mapping(bytes32 => bool)) paid;
        mapping(uint256 => mapping(address => uint256)) contributed;
        mapping(uint256 => mapping(address => bool)) refundClaimed;
        mapping(bytes32 => Favour) favours; // favourId = keccak256(abi.encode(funder, key))
        mapping(uint256 => uint256) contributorCount; // distinct contributors per campaign
        mapping(uint256 => uint256) refundsClaimed; // contributors who claimed after close
        mapping(uint256 => uint256) refundedAmount; // paid back so far after close
    }

    // keccak256(abi.encode(uint256(keccak256("morkeeth.favourpots")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FAVOUR_SLOT = 0x2bb421d923ced146a7e26bfe3c95a1af9484e8c891b4104e7d63a04773296500;

    event CampaignOpened(uint256 indexed id, address indexed token, uint256 cap, uint16 feeBps);
    event CampaignFunded(uint256 indexed id, address indexed funder, uint256 amount);
    event FavourPaid(uint256 indexed id, bytes32 indexed favourKey, address indexed recipient, uint256 net, uint256 fee, address by);
    event CampaignCapSet(uint256 indexed id, uint256 cap);
    event CampaignFrozenSet(uint256 indexed id, bool frozen);
    event CampaignShut(uint256 indexed id, uint256 remaining);
    event CampaignRefundClaimed(uint256 indexed id, address indexed contributor, uint256 amount);
    event FavourFunded(bytes32 indexed id, bytes32 key, address indexed funder, address token, uint256 amount, address releaser, uint64 deadline);
    event FavourReleased(bytes32 indexed id, address indexed recipient, uint256 net, uint256 fee, address by);
    event FavourRefunded(bytes32 indexed id, address indexed funder, uint256 amount, address by);

    error UnknownCampaign();
    error CampaignClosed();
    error CampaignOpen();
    error CampaignFrozen();
    error AlreadyPaid();
    error InsufficientPot();
    error FavourExists();
    error FavourNotFunded();
    error NotFunderOrReleaser();
    error NotExpired();
    error DeadlineInvalid();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IPermit2AllowanceTransfer permit2) ManagedUpgradeable(permit2) {}

    function initialize(address admin, address operator, address feeRecipient_, uint16 feeBps_) external initializer {
        __Managed_init(admin, operator, feeRecipient_, feeBps_);
    }

    function version() external pure virtual override returns (string memory) {
        return "favour-pots-3.0.0";
    }

    function _fs() private pure returns (FavourStorage storage $) {
        assembly {
            $.slot := FAVOUR_SLOT
        }
    }

    function _campaign(uint256 id) private view returns (Campaign storage c) {
        c = _fs().campaigns[id];
        if (c.token == address(0)) revert UnknownCampaign();
    }

    // ---------------- views ----------------
    function campaignCount() external view returns (uint256) {
        return _fs().campaignCount;
    }

    function getCampaign(uint256 id) external view returns (Campaign memory) {
        return _fs().campaigns[id];
    }

    function isPaid(uint256 id, bytes32 favourKey) external view returns (bool) {
        return _fs().paid[id][favourKey];
    }

    function contributed(uint256 id, address who) external view returns (uint256) {
        return _fs().contributed[id][who];
    }

    function refundClaimed(uint256 id, address who) external view returns (bool) {
        return _fs().refundClaimed[id][who];
    }

    /// @notice On-chain id of a single favour: the funder's own key, namespaced by the funder,
    ///  so nobody can front-run or squat another person's key.
    function favourId(address funder, bytes32 key) public pure returns (bytes32) {
        return keccak256(abi.encode(funder, key));
    }

    function getFavour(bytes32 id) external view returns (Favour memory) {
        return _fs().favours[id];
    }

    // ---------------- campaign pots ----------------
    function openCampaign(address token, uint256 cap) external onlyOperatorOrAdmin whenNotPaused returns (uint256 id) {
        _checkAmount(token, cap);
        FavourStorage storage $ = _fs();
        id = ++$.campaignCount;
        Campaign storage c = $.campaigns[id];
        c.token = token;
        c.feeBps = feeBps();
        c.cap = uint128(cap);
        emit CampaignOpened(id, token, cap, c.feeBps);
    }

    function fundCampaign(uint256 id, uint256 amount) external whenNotPaused nonReentrant {
        _fundCampaign(id, amount, false);
    }

    function fundCampaignWithPermit2(uint256 id, uint256 amount) external whenNotPaused nonReentrant {
        _fundCampaign(id, amount, true);
    }

    function _fundCampaign(uint256 id, uint256 amount, bool viaPermit2) private {
        Campaign storage c = _campaign(id);
        if (c.closed) revert CampaignClosed();
        _checkMin(c.token, amount);
        _pullIn(c.token, amount, viaPermit2);
        uint128 a = SafeCast.toUint128(amount);
        c.balance += a;
        c.totalFunded += a;
        FavourStorage storage $ = _fs();
        if ($.contributed[id][msg.sender] == 0) $.contributorCount[id] += 1;
        $.contributed[id][msg.sender] += amount;
        emit CampaignFunded(id, msg.sender, amount);
    }

    /// @notice Pay one favour from a pot. Worker chosen here. Never paused: it is an exit for workers.
    function payFromPot(uint256 id, bytes32 favourKey, address recipient, uint256 amount)
        external
        onlyOperatorOrAdmin
        nonReentrant
    {
        Campaign storage c = _campaign(id);
        if (c.closed) revert CampaignClosed();
        if (c.frozen && !_isAdmin(msg.sender)) revert CampaignFrozen();
        FavourStorage storage $ = _fs();
        if ($.paid[id][favourKey]) revert AlreadyPaid();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount < tokenConfig(c.token).minAmount || amount > c.cap) revert AmountOutOfRange();
        if (amount > c.balance) revert InsufficientPot();

        $.paid[id][favourKey] = true;
        c.balance -= uint128(amount);
        uint256 fee = (amount * c.feeBps) / BPS;
        _accrueFee(c.token, fee);
        emit FavourPaid(id, favourKey, recipient, amount - fee, fee, msg.sender);
        _payOut(c.token, recipient, amount - fee);
    }

    function setCampaignCap(uint256 id, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage c = _campaign(id);
        TokenConfig memory t = tokenConfig(c.token);
        if (cap < t.minAmount || cap > t.maxAmount) revert AmountOutOfRange();
        c.cap = uint128(cap);
        emit CampaignCapSet(id, cap);
    }

    function setCampaignFrozen(uint256 id, bool frozen) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _campaign(id).frozen = frozen;
        emit CampaignFrozenSet(id, frozen);
    }

    /// @notice Stops a pot for good. Unspent money goes back to contributors pro rata, by claim.
    function closeCampaign(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Campaign storage c = _campaign(id);
        if (c.closed) revert CampaignClosed();
        c.closed = true;
        c.remainingAtClose = c.balance;
        c.balance = 0;
        emit CampaignShut(id, c.remainingAtClose);
    }

    /// @notice Contributor pulls their share of a closed pot. Never paused. The last contributor to
    ///  claim also receives the rounding remainder, so no dust is ever locked.
    function claimCampaignRefund(uint256 id) external nonReentrant returns (uint256 share) {
        Campaign storage c = _campaign(id);
        if (!c.closed) revert CampaignOpen();
        FavourStorage storage $ = _fs();
        uint256 contrib = $.contributed[id][msg.sender];
        if (contrib == 0 || $.refundClaimed[id][msg.sender]) revert NothingToClaim();
        $.refundClaimed[id][msg.sender] = true;
        $.refundsClaimed[id] += 1;
        if ($.refundsClaimed[id] == $.contributorCount[id]) {
            share = uint256(c.remainingAtClose) - $.refundedAmount[id];
        } else {
            share = (uint256(c.remainingAtClose) * contrib) / c.totalFunded;
        }
        $.refundedAmount[id] += share;
        emit CampaignRefundClaimed(id, msg.sender, share);
        if (share != 0) _payOut(c.token, msg.sender, share);
    }

    // ---------------- single favours ----------------
    function fundFavour(bytes32 key, address token, uint256 amount, address releaser, uint64 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 id)
    {
        id = _fundFavour(key, token, amount, releaser, deadline, false);
    }

    function fundFavourWithPermit2(bytes32 key, address token, uint256 amount, address releaser, uint64 deadline)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 id)
    {
        id = _fundFavour(key, token, amount, releaser, deadline, true);
    }

    function _fundFavour(bytes32 key, address token, uint256 amount, address releaser, uint64 deadline, bool viaPermit2)
        private
        returns (bytes32 id)
    {
        id = favourId(msg.sender, key);
        Favour storage fv = _fs().favours[id];
        if (fv.status != FavourStatus.None) revert FavourExists();
        _checkAmount(token, amount);
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) revert DeadlineInvalid();
        fv.funder = msg.sender;
        fv.deadline = deadline;
        fv.feeBps = feeBps();
        fv.status = FavourStatus.Funded;
        fv.releaser = releaser;
        fv.token = token;
        fv.amount = uint128(amount);
        _pullIn(token, amount, viaPermit2);
        emit FavourFunded(id, key, msg.sender, token, amount, releaser, deadline);
    }

    /// @notice Funder (or the releaser the funder named) pays the worker chosen now. Never paused.
    function releaseFavour(bytes32 id, address recipient) external nonReentrant {
        Favour storage fv = _fs().favours[id];
        if (fv.status != FavourStatus.Funded) revert FavourNotFunded();
        if (msg.sender != fv.funder && (fv.releaser == address(0) || msg.sender != fv.releaser)) {
            revert NotFunderOrReleaser();
        }
        if (recipient == address(0)) revert ZeroAddress();
        fv.status = FavourStatus.Released;
        uint256 amount = fv.amount;
        uint256 fee = (amount * fv.feeBps) / BPS;
        _accrueFee(fv.token, fee);
        emit FavourReleased(id, recipient, amount - fee, fee, msg.sender);
        _payOut(fv.token, recipient, amount - fee);
    }

    /// @notice Back to the funder, no fee. Anyone after the deadline; admin at any time. Never paused.
    function refundFavour(bytes32 id) external nonReentrant {
        Favour storage fv = _fs().favours[id];
        if (fv.status != FavourStatus.Funded) revert FavourNotFunded();
        if (block.timestamp <= fv.deadline && !_isAdmin(msg.sender)) revert NotExpired();
        fv.status = FavourStatus.Refunded;
        emit FavourRefunded(id, fv.funder, fv.amount, msg.sender);
        _payOut(fv.token, fv.funder, fv.amount);
    }
}
