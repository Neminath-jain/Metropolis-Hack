// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WebAuthn} from "solady/utils/WebAuthn.sol";

/// @title IAgentGuard
/// @notice Interface for AgentGuard non-custodial vault and policy delegation engine
interface IAgentGuard {
    /// @notice Pre-call policy violation reasons emitted on failure
    enum ReasonCode {
        NO_SESSION,
        EXPIRED,
        TARGET_NOT_ALLOWED,
        SELECTOR_NOT_ALLOWED,
        TOKEN_NOT_ALLOWED,
        EXCEEDS_PER_TRADE,
        EXCEEDS_DAILY,
        INSUFFICIENT_BALANCE,
        BAD_PAIR
    }

    struct Session {
        bool active;
        uint64 expiresAt;
        uint256 agentId;
    }

    struct TokenLimit {
        uint128 dailyLimit;
        uint128 perTradeLimit;
        uint128 spentInWindow;
        uint64 windowStart;
    }

    struct TokenConfig {
        address token;
        uint128 dailyLimit;
        uint128 perTradeLimit;
    }

    struct TargetSelector {
        address target;
        bytes4 selector;
        bool allowed;
    }

    struct PairRate {
        address tokenIn;
        address tokenOut;
        uint256 minRate;
    }

    struct Policy {
        TokenConfig[] tokens;
        address[] targets;
        TargetSelector[] selectors;
        PairRate[] rates;
    }

    struct ExecuteParams {
        address user;
        address tokenIn;
        uint256 amountIn;
        address tokenOut;
        uint256 minAmountOut;
        address target;
        bytes data;
        bytes32 decisionHash;
    }

    struct Passkey {
        uint256 qx;
        uint256 qy;
    }

    // Events
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, address indexed to);
    event PolicyCreated(
        address indexed user, address indexed agent, uint256 agentId, uint64 expiresAt, bytes32 policyHash
    );
    event SessionRevoked(address indexed user, address indexed agent);
    event ActionExecuted(
        address indexed user,
        address indexed agent,
        address indexed target,
        address tokenIn,
        address tokenOut,
        uint256 spent,
        uint256 received,
        bytes32 decisionHash
    );
    event PolicyViolation(
        address indexed user, address indexed agent, ReasonCode indexed reasonCode, bytes32 decisionHash
    );
    event PasskeyRegistered(address indexed userId, uint256 qx, uint256 qy);
    event TargetApprovalUpdated(address indexed target, bool approved);
    event RegistryUpdated(address indexed registry);

    // Custom Errors
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error ZeroAgentAddress();
    error InvalidExpiry();
    error TargetNotGloballyApproved(address target);
    error InvalidTokenLimit(address token);
    error AgentNotRegistered(uint256 agentId);
    error AgentOwnerMismatch(uint256 agentId, address agent, address owner);
    error CallFailed();
    error SpentMoreThanAuthorized();
    error SlippageExceeded();
    error BelowUserRateFloor();
    error DeadlineExpired();
    error InvalidNonce();
    error InvalidSignatureS();
    error InvalidSignatureR();
    error InvalidPublicKey();
    error PasskeyNotRegistered();
    error WebAuthnVerificationFailed();
    error UserVerificationRequired();

    // Core Vault Functions
    function deposit(address token, uint256 amount) external returns (uint256 received);
    function depositFor(address user, address token, uint256 amount) external returns (uint256 received);
    function withdraw(address token, uint256 amount, address to) external;
    function withdrawWithPasskey(
        address userId,
        address token,
        uint256 amount,
        address to,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external;

    // Policy & Session Management
    function registerPasskey(uint256 qx, uint256 qy) external returns (address userId);
    function registerSession(address agent, uint256 agentId, uint64 expiresAt, Policy calldata policy) external;
    function registerSessionWithPasskey(
        address userId,
        address agent,
        uint256 agentId,
        uint64 expiresAt,
        Policy calldata policy,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external;
    function revokeSession(address agent) external;
    function revokeSessionWithPasskey(
        address userId,
        address agent,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external;

    // Agent Execution
    function execute(ExecuteParams calldata p) external returns (bool success);

    // Views
    function getSession(address user, address agent) external view returns (Session memory);
    function getLimit(address user, address agent, address token) external view returns (TokenLimit memory);
    function windowRemaining(address user, address agent, address token)
        external
        view
        returns (uint128 remainingBudget, uint64 secondsUntilReset);
    function passkeyOf(address userId) external view returns (Passkey memory);
    function nextNonce(address userId) external view returns (uint256);
}
