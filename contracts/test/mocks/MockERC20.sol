// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Configurable ERC20 token with optional decimals and fee-on-transfer behavior
contract MockERC20 is ERC20 {
    uint8 private immutable _customDecimals;
    uint256 public feeBasisPoints; // e.g. 100 = 1% fee on transfer

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _customDecimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _customDecimals;
    }

    function setFeeBasisPoints(uint256 bps) external {
        feeBasisPoints = bps;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (feeBasisPoints > 0) {
            uint256 fee = (amount * feeBasisPoints) / 10000;
            uint256 net = amount - fee;
            super.transfer(address(0xdead), fee);
            return super.transfer(to, net);
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        if (feeBasisPoints > 0) {
            uint256 fee = (amount * feeBasisPoints) / 10000;
            uint256 net = amount - fee;
            super.transferFrom(from, address(0xdead), fee);
            return super.transferFrom(from, to, net);
        }
        return super.transferFrom(from, to, amount);
    }
}
