// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ManagedUpgradeable, IPermit2AllowanceTransfer} from "./ManagedUpgradeable.sol";

/// @title PerfectRounds: PERFECT prize rounds (World Chain).
/// @notice Admin or operator opens a round (Oscar, 2 Nov 10:50: people do not create pots for now).
///  Anyone buys entries or sponsors the pot before close. The winner is ATTESTED, not proven:
///  the game server (operator) registers finished attempts (free or paid) and, after close,
///  proposes the winning attempt plus a board hash. After the challenge window anyone settles:
///  the winner and the fee bucket are credited (pull payments). The contract proves only that the
///  winner is a registered attempt of this round and the timing; it does not prove the score.
///  Escapes: operator or admin may cancel before settlement; if no winner is proposed by the
///  result deadline anyone may cancel. A cancelled round refunds every buyer and sponsor in full,
///  no fee. The fee (bps, max 10%) is copied into the round when it opens.
contract PerfectRounds is ManagedUpgradeable {
    uint256 public constant MAX_ENTRIES_PER_CALL = 100;
    uint256 public constant MAX_CHALLENGE_WINDOW = 7 days;
    uint256 public constant MAX_RESULT_WINDOW = 30 days;

    enum RoundStatus {
        None,
        Open,
        Proposed,
        Settled,
        Cancelled
    }

    struct Round {
        address token;
        uint16 feeBps;
        RoundStatus status;
        uint32 challengeWindow;
        uint64 closeTime;
        uint64 resultDeadline;
        uint64 proposedAt;
        uint128 entryPrice;
        uint128 pot;
        address winner;
        bytes32 winningAttempt;
        bytes32 boardHash;
    }

    /// @custom:storage-location erc7201:morkeeth.perfectrounds
    struct PerfectStorage {
        uint256 roundCount;
        mapping(uint256 => Round) rounds;
        mapping(uint256 => mapping(address => uint256)) contributed; // entries + sponsorship
        mapping(uint256 => mapping(bytes32 => address)) attemptPlayer;
        mapping(address => mapping(address => uint256)) credits; // token => account => claimable
    }

    // keccak256(abi.encode(uint256(keccak256("morkeeth.perfectrounds")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PERFECT_SLOT = 0xeef6cb9b3e300a40e03aa0d56188e176ce841a299ee7fb995884a8ecee73bd00;

    event RoundOpened(uint256 indexed id, address indexed token, uint256 entryPrice, uint64 closeTime, uint64 resultDeadline, uint32 challengeWindow, uint16 feeBps);
    event EntriesBought(uint256 indexed id, address indexed buyer, uint256 count, uint256 amount);
    event Sponsored(uint256 indexed id, address indexed sponsor, uint256 amount);
    event AttemptRegistered(uint256 indexed id, bytes32 indexed attemptHash, address indexed player);
    event WinnerProposed(uint256 indexed id, bytes32 indexed attemptHash, address indexed winner, bytes32 boardHash);
    event RoundSettled(uint256 indexed id, address indexed winner, uint256 prize, uint256 fee);
    event RoundCancelled(uint256 indexed id, address by);
    event Refunded(uint256 indexed id, address indexed account, uint256 amount);
    event Claimed(address indexed token, address indexed account, uint256 amount);

    error UnknownRound();
    error WrongStatus();
    error EntriesClosed();
    error TooEarly();
    error TooLate();
    error AttemptExists();
    error AttemptUnknown();
    error BadCount();
    error BadTimes();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IPermit2AllowanceTransfer permit2) ManagedUpgradeable(permit2) {}

    function initialize(address admin, address operator, address feeRecipient_, uint16 feeBps_) external initializer {
        __Managed_init(admin, operator, feeRecipient_, feeBps_);
    }

    function version() external pure virtual override returns (string memory) {
        return "perfect-rounds-1.0.0";
    }

    function _ps() private pure returns (PerfectStorage storage $) {
        assembly {
            $.slot := PERFECT_SLOT
        }
    }

    function _round(uint256 id) private view returns (Round storage rd) {
        rd = _ps().rounds[id];
        if (rd.status == RoundStatus.None) revert UnknownRound();
    }

    // ---------------- views ----------------
    function roundCount() external view returns (uint256) {
        return _ps().roundCount;
    }

    function getRound(uint256 id) external view returns (Round memory) {
        return _ps().rounds[id];
    }

    function contributed(uint256 id, address who) external view returns (uint256) {
        return _ps().contributed[id][who];
    }

    function attemptPlayer(uint256 id, bytes32 attemptHash) external view returns (address) {
        return _ps().attemptPlayer[id][attemptHash];
    }

    function credits(address token, address who) external view returns (uint256) {
        return _ps().credits[token][who];
    }

    // ---------------- open ----------------
    function openRound(address token, uint256 entryPrice, uint64 closeTime, uint64 resultDeadline, uint32 challengeWindow)
        external
        onlyOperatorOrAdmin
        whenNotPaused
        returns (uint256 id)
    {
        _checkAmount(token, entryPrice);
        if (
            closeTime <= block.timestamp || resultDeadline <= closeTime
                || resultDeadline > uint256(closeTime) + MAX_RESULT_WINDOW || challengeWindow > MAX_CHALLENGE_WINDOW
        ) revert BadTimes();
        PerfectStorage storage $ = _ps();
        id = ++$.roundCount;
        Round storage rd = $.rounds[id];
        rd.token = token;
        rd.feeBps = feeBps();
        rd.status = RoundStatus.Open;
        rd.challengeWindow = challengeWindow;
        rd.closeTime = closeTime;
        rd.resultDeadline = resultDeadline;
        rd.entryPrice = uint128(entryPrice);
        emit RoundOpened(id, token, entryPrice, closeTime, resultDeadline, challengeWindow, rd.feeBps);
    }

    // ---------------- money in ----------------
    function buyEntries(uint256 id, uint256 count) external whenNotPaused nonReentrant {
        _buy(id, count, false);
    }

    function buyEntriesWithPermit2(uint256 id, uint256 count) external whenNotPaused nonReentrant {
        _buy(id, count, true);
    }

    function sponsor(uint256 id, uint256 amount) external whenNotPaused nonReentrant {
        _sponsor(id, amount, false);
    }

    function sponsorWithPermit2(uint256 id, uint256 amount) external whenNotPaused nonReentrant {
        _sponsor(id, amount, true);
    }

    function _openForMoney(uint256 id) private view returns (Round storage rd) {
        rd = _round(id);
        if (rd.status != RoundStatus.Open) revert WrongStatus();
        if (block.timestamp >= rd.closeTime) revert EntriesClosed();
    }

    function _buy(uint256 id, uint256 count, bool viaPermit2) private {
        Round storage rd = _openForMoney(id);
        if (count == 0 || count > MAX_ENTRIES_PER_CALL) revert BadCount();
        uint256 amount = uint256(rd.entryPrice) * count;
        _credit(id, rd, amount, viaPermit2);
        emit EntriesBought(id, msg.sender, count, amount);
    }

    function _sponsor(uint256 id, uint256 amount, bool viaPermit2) private {
        Round storage rd = _openForMoney(id);
        _checkMin(rd.token, amount);
        _credit(id, rd, amount, viaPermit2);
        emit Sponsored(id, msg.sender, amount);
    }

    function _credit(uint256 id, Round storage rd, uint256 amount, bool viaPermit2) private {
        _pullIn(rd.token, amount, viaPermit2);
        rd.pot += uint128(amount);
        _ps().contributed[id][msg.sender] += amount;
    }

    // ---------------- result ----------------
    /// @notice Game server attests one finished attempt (free or paid). Not paused: not money in.
    function registerAttempt(uint256 id, address player, bytes32 attemptHash) external onlyOperatorOrAdmin {
        Round storage rd = _round(id);
        if (rd.status != RoundStatus.Open) revert WrongStatus();
        if (block.timestamp > rd.resultDeadline) revert TooLate();
        if (player == address(0)) revert ZeroAddress();
        if (attemptHash == bytes32(0)) revert AttemptUnknown();
        PerfectStorage storage $ = _ps();
        if ($.attemptPlayer[id][attemptHash] != address(0)) revert AttemptExists();
        $.attemptPlayer[id][attemptHash] = player;
        emit AttemptRegistered(id, attemptHash, player);
    }

    function proposeWinner(uint256 id, bytes32 attemptHash, bytes32 boardHash) external onlyOperatorOrAdmin {
        Round storage rd = _round(id);
        if (rd.status != RoundStatus.Open) revert WrongStatus();
        if (block.timestamp < rd.closeTime) revert TooEarly();
        if (block.timestamp > rd.resultDeadline) revert TooLate();
        address player = _ps().attemptPlayer[id][attemptHash];
        if (player == address(0)) revert AttemptUnknown();
        rd.status = RoundStatus.Proposed;
        rd.winner = player;
        rd.winningAttempt = attemptHash;
        rd.boardHash = boardHash;
        rd.proposedAt = uint64(block.timestamp);
        emit WinnerProposed(id, attemptHash, player, boardHash);
    }

    /// @notice Anyone, after the challenge window. Credits only; never transfers, so never blocked.
    function settle(uint256 id) external {
        Round storage rd = _round(id);
        if (rd.status != RoundStatus.Proposed) revert WrongStatus();
        if (block.timestamp < uint256(rd.proposedAt) + rd.challengeWindow) revert TooEarly();
        rd.status = RoundStatus.Settled;
        uint256 pot = rd.pot;
        uint256 fee = (pot * rd.feeBps) / BPS;
        _accrueFee(rd.token, fee);
        _ps().credits[rd.token][rd.winner] += pot - fee;
        emit RoundSettled(id, rd.winner, pot - fee, fee);
    }

    /// @notice Operator or admin: any time before settlement. Anyone: only if no winner was
    ///  proposed by the result deadline. Never paused.
    function cancel(uint256 id) external {
        Round storage rd = _round(id);
        bool privileged = hasRole(OPERATOR_ROLE, msg.sender) || _isAdmin(msg.sender);
        if (privileged) {
            if (rd.status != RoundStatus.Open && rd.status != RoundStatus.Proposed) revert WrongStatus();
        } else {
            if (rd.status != RoundStatus.Open) revert WrongStatus();
            if (block.timestamp <= rd.resultDeadline) revert TooEarly();
        }
        rd.status = RoundStatus.Cancelled;
        emit RoundCancelled(id, msg.sender);
    }

    // ---------------- exits ----------------
    function refund(uint256 id) external nonReentrant {
        Round storage rd = _round(id);
        if (rd.status != RoundStatus.Cancelled) revert WrongStatus();
        PerfectStorage storage $ = _ps();
        uint256 amount = $.contributed[id][msg.sender];
        if (amount == 0) revert NothingToClaim();
        $.contributed[id][msg.sender] = 0;
        emit Refunded(id, msg.sender, amount);
        _payOut(rd.token, msg.sender, amount);
    }

    function claim(address token) external nonReentrant {
        PerfectStorage storage $ = _ps();
        uint256 amount = $.credits[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        $.credits[token][msg.sender] = 0;
        emit Claimed(token, msg.sender, amount);
        _payOut(token, msg.sender, amount);
    }
}
