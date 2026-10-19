// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockDEX
/// @notice Configurable DEX venue simulating automated swaps
contract MockDEX {
    using SafeERC20 for IERC20;

    uint256 public rateMultiplier = 1;
    uint256 public rateDivider = 1;

    function setRate(uint256 multiplier, uint256 divider) external {
        require(divider > 0, "Divider cannot be 0");
        rateMultiplier = multiplier;
        rateDivider = divider;
    }

    /// @notice Swaps tokenIn for tokenOut at the configured exchange rate
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut)
        external
        returns (uint256 amountOut)
    {
        // Pull tokenIn from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Compute output tokens
        amountOut = (amountIn * rateMultiplier) / rateDivider;
        require(amountOut >= minAmountOut, "MockDEX: slippage exceeded");

        // Send tokenOut to caller
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}
