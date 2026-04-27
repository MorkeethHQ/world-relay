// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRelayEscrow {
    function taskCount() external view returns (uint256);
    function getTask(uint256 _taskId) external view returns (
        address poster,
        address claimant,
        string memory description,
        uint256 bounty,
        uint256 deadline,
        uint8 status
    );
    function refund(uint256 _taskId) external;
}

/// @title RelayAutomation — Chainlink-compatible keeper for auto-expiring tasks
/// @notice Checks for expired tasks in RelayEscrow and refunds them automatically
contract RelayAutomation {
    IRelayEscrow public immutable escrow;
    uint256 public lastPerformTime;
    uint256 public constant MAX_BATCH = 10;

    event TasksExpired(uint256[] taskIds, uint256 timestamp);

    constructor(address _escrow) {
        escrow = IRelayEscrow(_escrow);
    }

    /// @notice Chainlink Automation: check if any tasks need refunding
    function checkUpkeep(bytes calldata)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        uint256[] memory expired = _findExpired();
        upkeepNeeded = expired.length > 0;
        performData = abi.encode(expired);
    }

    /// @notice Chainlink Automation: refund expired tasks
    function performUpkeep(bytes calldata performData) external {
        uint256[] memory taskIds = abi.decode(performData, (uint256[]));

        uint256[] memory refunded = new uint256[](taskIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < taskIds.length; i++) {
            try escrow.refund(taskIds[i]) {
                refunded[count] = taskIds[i];
                count++;
            } catch {
                // Task may have been claimed or already refunded
            }
        }

        lastPerformTime = block.timestamp;

        // Emit only successful refunds
        if (count > 0) {
            uint256[] memory trimmed = new uint256[](count);
            for (uint256 j = 0; j < count; j++) {
                trimmed[j] = refunded[j];
            }
            emit TasksExpired(trimmed, block.timestamp);
        }
    }

    /// @notice View helper: get list of expired task IDs
    function getExpiredTaskIds() external view returns (uint256[] memory) {
        return _findExpired();
    }

    function _findExpired() internal view returns (uint256[] memory) {
        uint256 total = escrow.taskCount();
        uint256[] memory candidates = new uint256[](MAX_BATCH);
        uint256 found = 0;

        for (uint256 i = 0; i < total && found < MAX_BATCH; i++) {
            (,,, , uint256 deadline, uint8 status) = escrow.getTask(i);
            // Status 0 = Open, 1 = Claimed — both eligible for refund after deadline
            if ((status == 0 || status == 1) && block.timestamp > deadline) {
                candidates[found] = i;
                found++;
            }
        }

        uint256[] memory result = new uint256[](found);
        for (uint256 j = 0; j < found; j++) {
            result[j] = candidates[j];
        }
        return result;
    }
}
