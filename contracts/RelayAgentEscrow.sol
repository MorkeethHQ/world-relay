// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title RelayAgentEscrow — V2 escrow with per-agent balances
/// @notice Agents deposit USDC, create tasks from their balance, runners get paid on completion.
///         A relayer (server) can act on behalf of agents to create/release tasks.
contract RelayAgentEscrow {
    enum TaskStatus { Open, Claimed, Completed, Failed, Expired }

    struct Task {
        address agent;
        address claimant;
        string description;
        uint256 bounty;
        uint256 deadline;
        TaskStatus status;
    }

    IERC20 public immutable usdc;
    address public relayer;
    address public owner;

    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalSpent;
    mapping(address => bool) public authorizedRelayer;

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event TaskCreated(uint256 indexed taskId, address indexed agent, uint256 bounty, string description);
    event TaskClaimed(uint256 indexed taskId, address indexed claimant);
    event TaskCompleted(uint256 indexed taskId, address indexed claimant, uint256 bounty);
    event TaskFailed(uint256 indexed taskId);
    event TaskRefunded(uint256 indexed taskId, address indexed agent, uint256 bounty);
    event RelayerUpdated(address indexed relayer, bool authorized);

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

    constructor(address _usdc, address _relayer) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
        relayer = _relayer;
        authorizedRelayer[_relayer] = true;
    }

    // ─── Agent Balance Management ───────────────────────────────────

    /// @notice Deposit USDC into agent balance. Call approve() on USDC first.
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        balances[msg.sender] += amount;
        totalDeposited[msg.sender] += amount;

        emit Deposited(msg.sender, amount, balances[msg.sender]);
    }

    /// @notice Withdraw unused balance back to agent wallet
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        balances[msg.sender] -= amount;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    // ─── Task Lifecycle ─────────────────────────────────────────────

    /// @notice Create a task funded from the agent's deposited balance
    function createTask(
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) external returns (uint256) {
        return _createTask(msg.sender, _description, _bounty, _deadline);
    }

    /// @notice Relayer creates a task on behalf of an agent
    function createTaskFor(
        address _agent,
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) external onlyAgentOrRelayer(_agent) returns (uint256) {
        return _createTask(_agent, _description, _bounty, _deadline);
    }

    function _createTask(
        address _agent,
        string calldata _description,
        uint256 _bounty,
        uint256 _deadline
    ) internal returns (uint256) {
        require(_bounty > 0, "Bounty must be > 0");
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

    /// @notice Runner claims an open task
    function claimTask(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp < task.deadline, "Task expired");
        require(msg.sender != task.agent, "Cannot claim own task");

        task.claimant = msg.sender;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(_taskId, msg.sender);
    }

    /// @notice Release payment to runner (agent or relayer)
    function releasePayment(uint256 _taskId) external onlyAgentOrRelayer(tasks[_taskId].agent) {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");

        task.status = TaskStatus.Completed;
        require(usdc.transfer(task.claimant, task.bounty), "Transfer failed");

        emit TaskCompleted(_taskId, task.claimant, task.bounty);
    }

    /// @notice Fail a task — bounty returns to agent balance
    function failTask(uint256 _taskId) external onlyAgentOrRelayer(tasks[_taskId].agent) {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");

        task.status = TaskStatus.Open;
        task.claimant = address(0);

        emit TaskFailed(_taskId);
    }

    /// @notice Refund expired task — bounty returns to agent balance
    function refund(uint256 _taskId) external {
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

    function transferOwnership(address _newOwner) external onlyOwner {
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
}
