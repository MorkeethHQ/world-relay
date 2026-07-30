// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Faithful subset of canonical Permit2's AllowanceTransfer semantics
///      (github.com/Uniswap/permit2, AllowanceTransfer.sol + Allowance.sol):
///        - approve(token, spender, amount, expiration) keyed by msg.sender;
///          expiration == 0 stores block.timestamp ("the allowance only lasts
///          the duration of the block" — Allowance.updateAmountAndExpiration).
///        - transferFrom(from, to, amount, token) checks strict expiry
///          (block.timestamp > expiration reverts) and deducts the allowance
///          unless it is uint160-max, exactly like _transfer in the original.
///        - The token-level pull uses ERC-20 transferFrom, standing in for
///          World App's automatic token approval to Permit2.
contract MockPermit2 {
    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
    }

    // owner => token => spender
    mapping(address => mapping(address => mapping(address => PackedAllowance))) public allowance;

    error AllowanceExpired(uint256 deadline);
    error InsufficientAllowance(uint256 amount);

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        PackedAllowance storage allowed = allowance[msg.sender][token][spender];
        allowed.amount = amount;
        allowed.expiration = expiration == 0 ? uint48(block.timestamp) : expiration;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        PackedAllowance storage allowed = allowance[from][token][msg.sender];
        if (block.timestamp > allowed.expiration) revert AllowanceExpired(allowed.expiration);
        uint256 maxAmount = allowed.amount;
        if (maxAmount != type(uint160).max) {
            if (amount > maxAmount) revert InsufficientAllowance(maxAmount);
            allowed.amount = uint160(maxAmount) - amount;
        }
        require(IERC20(token).transferFrom(from, to, amount), "MockPermit2: pull failed");
    }
}
