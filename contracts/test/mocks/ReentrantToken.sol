// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IEscrowTarget {
    function fund(bytes32 taskId, address recipient, uint96 amount, uint64 deadline) external;
    function release(bytes32 taskId) external;
    function refund(bytes32 taskId) external;
}

/// @dev ERC20 that attacks the escrow DURING a transfer/transferFrom, simulating a
///      hooked token. Real USDC has no hooks; this proves the guard + CEI hold even
///      if the token were hostile.
contract ReentrantToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    IEscrowTarget public target;
    bytes public attackCall; // abi-encoded call to replay mid-transfer
    bool internal attacking;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setAttack(IEscrowTarget _target, bytes calldata _call) external {
        target = _target;
        attackCall = _call;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _reenter();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _reenter();
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function _reenter() internal {
        if (address(target) != address(0) && attackCall.length > 0 && !attacking) {
            attacking = true;
            (bool ok, bytes memory ret) = address(target).call(attackCall);
            attacking = false;
            // Surface the result so tests can assert the inner call REVERTED.
            if (ok) revert("reentrancy succeeded"); // tests expect this NOT to happen silently
            ret; // inner revert is the expected outcome; swallow and continue
        }
    }
}
