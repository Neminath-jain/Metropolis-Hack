// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";

/// @title MockAgentRegistry
/// @notice Mock implementation of the ERC-8004 Identity Registry
contract MockAgentRegistry is IAgentRegistry {
    uint256 private _nextAgentId = 1;
    mapping(uint256 => address) public owners;
    mapping(uint256 => string) public tokenURIs;

    function setAgentOwner(uint256 agentId, address owner) external {
        owners[agentId] = owner;
    }

    function ownerOf(uint256 agentId) external view override returns (address) {
        address owner = owners[agentId];
        require(owner != address(0), "ERC721: invalid token ID");
        return owner;
    }

    function register(string calldata uri) external override returns (uint256 agentId) {
        agentId = _nextAgentId++;
        owners[agentId] = msg.sender;
        tokenURIs[agentId] = uri;
    }

    function tokenURI(uint256 agentId) external view override returns (string memory) {
        require(owners[agentId] != address(0), "ERC721: invalid token ID");
        return tokenURIs[agentId];
    }
}
