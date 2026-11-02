// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Canonical Permit2 AllowanceTransfer entry point (0x000000000022D473030F116dDEE9F6B43aC78BA3 on World Chain).
interface IPermit2AllowanceTransfer {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @title ManagedUpgradeable: shared money plumbing for FAVOUR v3 and PERFECT.
/// @notice UUPS upgradeable, with a 6 hour delay on every upgrade (Oscar, 2 Nov 2026).
///  Roles: DEFAULT_ADMIN_ROLE (Oscar, held by the agent wallet until > 1000 USDC is deployed),
///  OPERATOR_ROLE (server key: day to day actions within caps), PAUSER_ROLE (admin + operator).
///  Settings change instantly within hard caps written here: fee <= 10%, minimum > 0, min <= max.
///  Pause stops new money coming in. It never blocks payouts, refunds, claims or fee withdrawals.
///  Honest limit: an upgrade can change any rule, including these caps. The 6 hour delay plus the
///  UpgradeScheduled event is what gives users time to leave before a new version takes effect.
abstract contract ManagedUpgradeable is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant UPGRADE_DELAY = 6 hours;
    uint16 public constant MAX_FEE_BPS = 1000; // 10% hard cap
    uint16 internal constant BPS = 10_000;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IPermit2AllowanceTransfer public immutable PERMIT2;

    struct TokenConfig {
        bool allowed; // new money in only with allowed tokens; exits never check this
        uint128 minAmount; // e.g. 100_000 = 0.1 USDC
        uint128 maxAmount; // cap per favour / per entry price
    }

    /// @custom:storage-location erc7201:morkeeth.managed
    struct ManagedStorage {
        uint16 feeBps;
        address feeRecipient;
        mapping(address => TokenConfig) tokens;
        mapping(address => uint256) owed; // every unit the contract has promised to someone
        mapping(address => uint256) feesAccrued; // part of owed, belongs to feeRecipient
        mapping(address => uint256) upgradeEta; // implementation => earliest upgrade time
    }

    // keccak256(abi.encode(uint256(keccak256("morkeeth.managed")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MANAGED_SLOT = 0x259b5a1d8a9a64e61390990f1be93370f28628eb58e8ba8e0be82f34a593df00;

    event FeeSet(uint16 feeBps, address indexed feeRecipient);
    event TokenSet(address indexed token, bool allowed, uint128 minAmount, uint128 maxAmount);
    event UpgradeScheduled(address indexed implementation, uint256 eta);
    event UpgradeCancelled(address indexed implementation);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);
    event ExcessSwept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error NotAContract();
    error TokenNotAllowed();
    error AmountOutOfRange();
    error FeeTooHigh();
    error NothingToClaim();
    error NotOperatorOrAdmin();
    error UpgradeNotScheduled(address implementation);
    error UpgradeTooEarly(address implementation, uint256 eta);
    error UnexpectedAmountReceived();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IPermit2AllowanceTransfer permit2) {
        if (address(permit2) == address(0)) revert ZeroAddress();
        PERMIT2 = permit2;
        _disableInitializers();
    }

    function __Managed_init(address admin, address operator, address feeRecipient_, uint16 feeBps_)
        internal
        onlyInitializing
    {
        if (admin == address(0) || operator == address(0)) revert ZeroAddress();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(PAUSER_ROLE, operator);
        _setFee(feeBps_, feeRecipient_);
    }

    function _ms() internal pure returns (ManagedStorage storage $) {
        assembly {
            $.slot := MANAGED_SLOT
        }
    }

    modifier onlyOperatorOrAdmin() {
        if (!hasRole(OPERATOR_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotOperatorOrAdmin();
        }
        _;
    }

    // ---------------- views ----------------
    function feeBps() public view returns (uint16) {
        return _ms().feeBps;
    }

    function feeRecipient() public view returns (address) {
        return _ms().feeRecipient;
    }

    function tokenConfig(address token) public view returns (TokenConfig memory) {
        return _ms().tokens[token];
    }

    function owed(address token) public view returns (uint256) {
        return _ms().owed[token];
    }

    function feesAccrued(address token) public view returns (uint256) {
        return _ms().feesAccrued[token];
    }

    function upgradeEta(address implementation) public view returns (uint256) {
        return _ms().upgradeEta[implementation];
    }

    function version() external pure virtual returns (string memory);

    // ---------------- admin settings ----------------
    function setFee(uint16 feeBps_, address feeRecipient_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFee(feeBps_, feeRecipient_);
    }

    function _setFee(uint16 feeBps_, address feeRecipient_) private {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        ManagedStorage storage $ = _ms();
        $.feeBps = feeBps_;
        $.feeRecipient = feeRecipient_;
        emit FeeSet(feeBps_, feeRecipient_);
    }

    function setToken(address token, bool allowed, uint256 minAmount, uint256 maxAmount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (token == address(0)) revert ZeroAddress();
        if (minAmount == 0 || minAmount > maxAmount || maxAmount > type(uint128).max) revert AmountOutOfRange();
        _ms().tokens[token] = TokenConfig(allowed, uint128(minAmount), uint128(maxAmount));
        emit TokenSet(token, allowed, uint128(minAmount), uint128(maxAmount));
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------- upgrades (6 hour delay) ----------------
    function scheduleUpgrade(address implementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (implementation == address(0)) revert ZeroAddress();
        if (implementation.code.length == 0) revert NotAContract();
        uint256 eta = block.timestamp + UPGRADE_DELAY;
        _ms().upgradeEta[implementation] = eta;
        emit UpgradeScheduled(implementation, eta);
    }

    function cancelUpgrade(address implementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete _ms().upgradeEta[implementation];
        emit UpgradeCancelled(implementation);
    }

    function _authorizeUpgrade(address implementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 eta = _ms().upgradeEta[implementation];
        if (eta == 0) revert UpgradeNotScheduled(implementation);
        if (block.timestamp < eta) revert UpgradeTooEarly(implementation, eta);
        delete _ms().upgradeEta[implementation];
    }

    // ---------------- fees and stray funds ----------------
    /// @notice Anyone may push accrued fees to the fee recipient. Never paused.
    function withdrawFees(address token) external nonReentrant {
        ManagedStorage storage $ = _ms();
        uint256 amount = $.feesAccrued[token];
        if (amount == 0) revert NothingToClaim();
        $.feesAccrued[token] = 0;
        address to = $.feeRecipient;
        _payOut(token, to, amount);
        emit FeesWithdrawn(token, to, amount);
    }

    /// @notice Admin recovers only tokens sent here by mistake: balance above everything owed.
    function sweepExcess(address token, address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 o = _ms().owed[token];
        if (bal <= o) revert NothingToClaim();
        uint256 excess = bal - o;
        IERC20(token).safeTransfer(to, excess);
        emit ExcessSwept(token, to, excess);
    }

    // ---------------- internal money movement ----------------
    function _checkAmount(address token, uint256 amount) internal view {
        TokenConfig storage c = _ms().tokens[token];
        if (!c.allowed) revert TokenNotAllowed();
        if (amount < c.minAmount || amount > c.maxAmount) revert AmountOutOfRange();
    }

    function _checkMin(address token, uint256 amount) internal view {
        TokenConfig storage c = _ms().tokens[token];
        if (!c.allowed) revert TokenNotAllowed();
        if (amount < c.minAmount) revert AmountOutOfRange();
    }

    /// Pulls exactly `amount` from msg.sender, plain allowance or Permit2. Rejects fee-on-transfer tokens.
    function _pullIn(address token, uint256 amount, bool viaPermit2) internal {
        uint256 before = IERC20(token).balanceOf(address(this));
        if (viaPermit2) {
            if (amount > type(uint160).max) revert AmountOutOfRange();
            PERMIT2.transferFrom(msg.sender, address(this), uint160(amount), token);
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        if (IERC20(token).balanceOf(address(this)) - before != amount) revert UnexpectedAmountReceived();
        _ms().owed[token] += amount;
    }

    function _payOut(address token, address to, uint256 amount) internal {
        _ms().owed[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
    }

    /// Moves `fee` from a payout into the fee bucket. Stays inside `owed`.
    function _accrueFee(address token, uint256 fee) internal {
        if (fee != 0) _ms().feesAccrued[token] += fee;
    }

    function _isAdmin(address who) internal view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, who);
    }
}
