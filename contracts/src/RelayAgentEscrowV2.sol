// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @title RelayAgentEscrowV2 — Upgradeable escrow with per-agent balances, fees, and safety
/// @notice Agents deposit USDC, create tasks from their balance, runners get paid on completion.
///         A relayer (server) can act on behalf of agents to create/release tasks.
contract RelayAgentEscrowV2 is Initializable, UUPSUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    enum TaskStatus { Open, Claimed, Completed, Failed, Expired }

    struct Task {
        address agent;
        address claimant;
        string description;
        uint256 bounty;
        uint256 deadline;
        TaskStatus status;
    }

    IERC20 public usdc;
    address public owner;

    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalSpent;
    mapping(address => bool) public authorizedRelayer;

    uint256 public feeRate; // basis points (250 = 2.5%)
    address public feeRecipient;
    uint256 public totalFeesCollected;
    uint256 public constant MIN_BOUNTY = 500_000; // 0.50 USDC (6 decimals)
    uint256 public constant MAX_FEE_RATE = 1000; // 10% max fee

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event TaskCreated(uint256 indexed taskId, address indexed agent, uint256 bounty, string description);
    event TaskClaimed(uint256 indexed taskId, address indexed claimant);
    event TaskCompleted(uint256 indexed taskId, address indexed claimant, uint256 payout, uint256 fee);
    event TaskFailed(uint256 indexed taskId);
    event TaskRefunded(uint256 indexed taskId, address indexed agent, uint256 bounty);
    event RelayerUpdated(address indexed relayer, bool authorized);
    event FeeUpdated(uint256 newRate, address newRecipient);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAgentOrRelayer(address agent) {
        require(
            msg.sender == agent || authorizedRelayer[msg.sender],
            "Not agent or authorized relayer"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _usdc, address _relayer, address _feeRecipient) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        usdc = IERC20(_usdc);
        owner = msg.sender;
        authorizedRelayer[_relayer] = true;
        feeRate = 250; // 2.5%
        feeRecipient = _feeRecipient;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ─── Agent Balance Management ───────────────────────────────────

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        balances[msg.sender] += amount;
        totalDeposited[msg.sender] += amount;

        emit Deposited(msg.sender, amount, balances[msg.sender]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    // ─── Task Lifecycle ─────────────────────────────────────────────

    function createTask(
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) external whenNotPaused returns (uint256) {
        return _createTask(msg.sender, _description, _bounty, _deadline);
    }

    function createTaskFor(
        address _agent,
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) external whenNotPaused onlyAgentOrRelayer(_agent) returns (uint256) {
        return _createTask(_agent, _description, _bounty, _deadline);
    }

    function _createTask(
        address _agent,
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) internal returns (uint256) {
        require(_bounty >= MIN_BOUNTY, "Bounty below minimum (0.50 USDC)");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(balances[_agent] >= _bounty, "Insufficient agent balance");

        balances[_agent] -= _bounty;
        totalSpent[_agent] += _bounty;

        uint256 taskId = taskCount++;
        tasks[taskId] = Task({
            agent: _agent,
            claimant: address(0),
            description: _description,
            bounty: _bounty,
            deadline: _deadline,
            status: TaskStatus.Open
        });

        emit TaskCreated(taskId, _agent, _bounty, _description);
        return taskId;
    }

    function claimTask(uint256 _taskId) external whenNotPaused {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp < task.deadline, "Task expired");
        require(msg.sender != task.agent, "Cannot claim own task");

        task.claimant = msg.sender;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(_taskId, msg.sender);
    }

    function releasePayment(uint256 _taskId) external nonReentrant onlyAgentOrRelayer(tasks[_taskId].agent) {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");

        task.status = TaskStatus.Completed;

        uint256 fee = (task.bounty * feeRate) / 10000;
        uint256 payout = task.bounty - fee;

        require(usdc.transfer(task.claimant, payout), "Payout failed");
        if (fee > 0) {
            require(usdc.transfer(feeRecipient, fee), "Fee transfer failed");
            totalFeesCollected += fee;
        }

        emit TaskCompleted(_taskId, task.claimant, payout, fee);
    }

    function failTask(uint256 _taskId) external onlyAgentOrRelayer(tasks[_taskId].agent) {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");

        task.status = TaskStatus.Open;
        task.claimant = address(0);

        emit TaskFailed(_taskId);
    }

    function refund(uint256 _taskId) external nonReentrant {
        Task storage task = tasks[_taskId];
        require(
            task.status == TaskStatus.Open || task.status == TaskStatus.Claimed,
            "Cannot refund"
        );
        require(block.timestamp > task.deadline, "Deadline not passed");

        task.status = TaskStatus.Expired;
        balances[task.agent] += task.bounty;
        totalSpent[task.agent] -= task.bounty;

        emit TaskRefunded(_taskId, task.agent, task.bounty);
    }

    // ─── Admin ──────────────────────────────────────────────────────

    function setRelayer(address _relayer, bool _authorized) external onlyOwner {
        authorizedRelayer[_relayer] = _authorized;
        emit RelayerUpdated(_relayer, _authorized);
    }

    function setFee(uint256 _feeRate, address _feeRecipient) external onlyOwner {
        require(_feeRate <= MAX_FEE_RATE, "Fee too high");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        feeRate = _feeRate;
        feeRecipient = _feeRecipient;
        emit FeeUpdated(_feeRate, _feeRecipient);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }

    // ─── View Functions ─────────────────────────────────────────────

    function getTask(uint256 _taskId) external view returns (Task memory) {
        return tasks[_taskId];
    }

    function getAgentStats(address _agent) external view returns (
        uint256 balance,
        uint256 deposited,
        uint256 spent
    ) {
        return (balances[_agent], totalDeposited[_agent], totalSpent[_agent]);
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
