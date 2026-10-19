// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Placeholder
/// @notice Initial placeholder contract for Aegis-Monad Foundry setup
contract Placeholder {
    string public constant NAME = "Aegis-Monad";
    uint256 public constant CHAIN_ID = 10143;

    function getChainId() external pure returns (uint256) {
        return CHAIN_ID;
    }
}
