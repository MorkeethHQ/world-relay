// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// 6-decimal stand-in for World Chain USDC in unit tests. Fork tests use the real token.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Mimics a USDC blacklist so tests can prove one blocked address cannot freeze others.
    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        require(!blocked[from] && !blocked[to], "blocked");
        super._update(from, to, value);
    }
}

/// Minimal AllowanceTransfer Permit2 for unit tests. Fork tests use canonical Permit2.
contract MockPermit2 {
    struct Allow {
        uint160 amount;
        uint48 expiration;
    }

    mapping(address => mapping(address => mapping(address => Allow))) public allowance; // owner => token => spender

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        allowance[msg.sender][token][spender] = Allow(amount, expiration);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        Allow storage a = allowance[from][token][msg.sender];
        require(a.expiration == 0 ? true : block.timestamp <= a.expiration, "expired");
        require(a.amount >= amount, "insufficient");
        if (a.amount != type(uint160).max) a.amount -= amount;
        require(IERC20(token).transferFrom(from, to, amount), "tf");
    }
}
