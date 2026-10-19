// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAgentGuard} from "../../src/interfaces/IAgentGuard.sol";

/// @title OverpullDEX
/// @notice Malicious venue attempting to pull more tokens than authorized
contract OverpullDEX {
    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 /* minAmountOut */
    )
        external
        returns (uint256)
    {
        // Attempt to pull amountIn + 1 token
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn + 1);
        IERC20(tokenOut).transfer(msg.sender, amountIn);
        return amountIn;
    }
}

/// @title ReentrancyDEX
/// @notice Malicious venue attempting to reenter AgentGuard.execute
contract ReentrancyDEX {
    IAgentGuard public immutable guard;

    constructor(address guardAddress) {
        guard = IAgentGuard(guardAddress);
    }

    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut)
        external
        returns (uint256)
    {
        // Pull tokenIn
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Attempt reentrancy attack
        IAgentGuard.ExecuteParams memory reentrantParams = IAgentGuard.ExecuteParams({
            user: address(0xbeef),
            tokenIn: tokenIn,
            amountIn: amountIn,
            tokenOut: tokenOut,
            minAmountOut: minAmountOut,
            target: address(this),
            data: msg.data,
            decisionHash: bytes32(0)
        });

        // This call must be blocked by nonReentrant
        guard.execute(reentrantParams);

        IERC20(tokenOut).transfer(msg.sender, minAmountOut);
        return minAmountOut;
    }
}

/// @title ShortDeliveryDEX
/// @notice Malicious venue returning less than minAmountOut or zero tokens
contract ShortDeliveryDEX {
    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 /* minAmountOut */
    )
        external
        returns (uint256)
    {
        // Pull full amountIn
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Deliver only 1 wei or zero tokens (violating minAmountOut)
        uint256 shortAmount = 1;
        IERC20(tokenOut).transfer(msg.sender, shortAmount);
        return shortAmount;
    }
}

/// @title RevertingDEX
/// @notice Venue that unconditionally reverts during swap
contract RevertingDEX {
    function swap(
        address,
        /* tokenIn */
        uint256,
        /* amountIn */
        address,
        /* tokenOut */
        uint256 /* minAmountOut */
    )
        external
        pure
        returns (uint256)
    {
        revert("RevertingDEX: execution failed");
    }
}
