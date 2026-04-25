// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title RelayDoubleOrNothing — high-stakes task verification
/// @notice Poster deposits bounty. Runner matches it. Verified = runner gets 2x. Failed = poster keeps both.
contract RelayDoubleOrNothing {
    enum TaskStatus { Open, Staked, Completed, Failed, Expired }

    struct Task {
        address poster;
        address runner;
        string description;
        uint256 bounty;       // poster's deposit
        uint256 stake;        // runner's matching deposit
        uint256 deadline;
        TaskStatus status;
    }

    IERC20 public immutable usdc;
    address public arbiter;   // address authorized to resolve tasks (backend wallet)
    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;

    event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 bounty, string description);
    event TaskStaked(uint256 indexed taskId, address indexed runner, uint256 stake);
    event TaskResolved(uint256 indexed taskId, bool verified, address winner, uint256 payout);
    event TaskExpired(uint256 indexed taskId, address indexed poster, address indexed runner);

    constructor(address _usdc, address _arbiter) {
        usdc = IERC20(_usdc);
        arbiter = _arbiter;
    }

    function createTask(string calldata _description, uint256 _bounty, uint256 _deadline) external returns (uint256) {
        require(_bounty > 0, "Bounty must be > 0");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(usdc.transferFrom(msg.sender, address(this), _bounty), "USDC transfer failed");

        uint256 taskId = taskCount++;
        tasks[taskId] = Task({
            poster: msg.sender,
            runner: address(0),
            description: _description,
            bounty: _bounty,
            stake: 0,
            deadline: _deadline,
            status: TaskStatus.Open
        });

        emit TaskCreated(taskId, msg.sender, _bounty, _description);
        return taskId;
    }

    /// @notice Runner stakes matching USDC to claim the task
    function stakeAndClaim(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp < task.deadline, "Task expired");
        require(msg.sender != task.poster, "Cannot claim own task");

        uint256 matchingStake = task.bounty;
        require(usdc.transferFrom(msg.sender, address(this), matchingStake), "Stake transfer failed");

        task.runner = msg.sender;
        task.stake = matchingStake;
        task.status = TaskStatus.Staked;

        emit TaskStaked(_taskId, msg.sender, matchingStake);
    }

    /// @notice Arbiter resolves: verified = runner gets bounty + stake. Failed = poster gets both.
    function resolve(uint256 _taskId, bool _verified) external {
        require(msg.sender == arbiter, "Only arbiter");
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Staked, "Task not staked");

        uint256 totalPool = task.bounty + task.stake;

        if (_verified) {
            task.status = TaskStatus.Completed;
            require(usdc.transfer(task.runner, totalPool), "Payout failed");
            emit TaskResolved(_taskId, true, task.runner, totalPool);
        } else {
            task.status = TaskStatus.Failed;
            require(usdc.transfer(task.poster, totalPool), "Refund failed");
            emit TaskResolved(_taskId, false, task.poster, totalPool);
        }
    }

    /// @notice Anyone can trigger refund after deadline if task is still open or staked
    function expire(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open || task.status == TaskStatus.Staked, "Cannot expire");
        require(block.timestamp > task.deadline, "Deadline not passed");

        task.status = TaskStatus.Expired;

        // Return funds to respective depositors
        if (task.stake > 0) {
            require(usdc.transfer(task.runner, task.stake), "Runner refund failed");
        }
        require(usdc.transfer(task.poster, task.bounty), "Poster refund failed");

        emit TaskExpired(_taskId, task.poster, task.runner);
    }

    function getTask(uint256 _taskId) external view returns (Task memory) {
        return tasks[_taskId];
    }

    function setArbiter(address _newArbiter) external {
        require(msg.sender == arbiter, "Only arbiter");
        arbiter = _newArbiter;
    }
}
