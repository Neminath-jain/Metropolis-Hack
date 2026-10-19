// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAgentRegistry
/// @notice Interface for the ERC-8004 Identity Registry on Monad
interface IAgentRegistry {
    /// @notice Returns the controller/owner of the agent token
    /// @param agentId The unique agent identifier
    /// @return The address owning the agent identity
    function ownerOf(uint256 agentId) external view returns (address);

    /// @notice Registers an agent identity NFT pointing to metadata
    /// @param tokenURI The URI locating agent registration metadata
    /// @return agentId The newly minted agent token identifier
    function register(string calldata tokenURI) external returns (uint256 agentId);

    /// @notice Returns the metadata URI for a registered agent
    /// @param agentId The unique agent identifier
    /// @return The metadata URI string
    function tokenURI(uint256 agentId) external view returns (string memory);
}
