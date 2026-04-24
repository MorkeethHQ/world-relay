// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RelayEscrow {
    enum TaskStatus { Open, Claimed, Completed, Failed, Expired }

    struct Task {
        address poster;
        address claimant;
        string description;
        uint256 bounty;
        uint256 deadline;
        TaskStatus status;
    }

    IERC20 public immutable usdc;
    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;
    mapping(address => uint256) public completions;

    event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 bounty, string description);
    event TaskClaimed(uint256 indexed taskId, address indexed claimant);
    event TaskCompleted(uint256 indexed taskId, address indexed claimant, uint256 bounty);
    event TaskFailed(uint256 indexed taskId);
    event TaskRefunded(uint256 indexed taskId, address indexed poster);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function createTask(string calldata _description, uint256 _bounty, uint256 _deadline) external returns (uint256) {
        require(_bounty > 0, "Bounty must be > 0");
        require(_deadline > block.timestamp, "Deadline must be future");
        require(usdc.transferFrom(msg.sender, address(this), _bounty), "USDC transfer failed");

        uint256 taskId = taskCount++;
        tasks[taskId] = Task({
            poster: msg.sender,
            claimant: address(0),
            description: _description,
            bounty: _bounty,
            deadline: _deadline,
            status: TaskStatus.Open
        });

        emit TaskCreated(taskId, msg.sender, _bounty, _description);
        return taskId;
    }

    function claimTask(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open, "Task not open");
        require(block.timestamp < task.deadline, "Task expired");
        require(msg.sender != task.poster, "Cannot claim own task");

        task.claimant = msg.sender;
        task.status = TaskStatus.Claimed;

        emit TaskClaimed(_taskId, msg.sender);
    }

    function releasePayment(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");
        require(msg.sender == task.poster, "Only poster can release");

        task.status = TaskStatus.Completed;
        completions[task.claimant]++;
        require(usdc.transfer(task.claimant, task.bounty), "USDC transfer failed");

        emit TaskCompleted(_taskId, task.claimant, task.bounty);
    }

    function failTask(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Claimed, "Task not claimed");
        require(msg.sender == task.poster, "Only poster can fail");

        task.status = TaskStatus.Open;
        task.claimant = address(0);

        emit TaskFailed(_taskId);
    }

    function refund(uint256 _taskId) external {
        Task storage task = tasks[_taskId];
        require(task.status == TaskStatus.Open || task.status == TaskStatus.Claimed, "Cannot refund");
        require(block.timestamp > task.deadline, "Deadline not passed");

        task.status = TaskStatus.Expired;
        require(usdc.transfer(task.poster, task.bounty), "USDC transfer failed");

        emit TaskRefunded(_taskId, task.poster);
    }

    function getTask(uint256 _taskId) external view returns (Task memory) {
        return tasks[_taskId];
    }

    function getCompletions(address _user) external view returns (uint256) {
        return completions[_user];
    }
}
