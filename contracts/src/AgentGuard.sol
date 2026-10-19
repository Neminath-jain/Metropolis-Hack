// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";
import {IAgentGuard} from "./interfaces/IAgentGuard.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/**
 * @title AgentGuard
 * @notice Open delegation primitive and policy engine on Monad.
 *
 * ============================================================================
 * THREAT MODEL & SECURITY ASSUMPTIONS
 * ============================================================================
 *
 * 1. MALICIOUS AGENT:
 *    - CAN attempt to execute trades up to user-configured per-trade and daily limits.
 *    - CAN choose suboptimal execution venues or bad pricing within allowed parameters.
 *    - CAN consume their own transaction gas on failed executions.
 *    - CANNOT exceed per-trade spending caps.
 *    - CANNOT exceed rolling 24-hour daily token budget caps.
 *    - CANNOT trade unauthorized tokens (tokens with dailyLimit == 0).
 *    - CANNOT call unauthorized venues (targets) or disallowed function selectors.
 *    - CANNOT breach user slippage floors (minAmountOut) or minRate exchange ratios.
 *    - CANNOT access or drain funds belonging to any other user.
 *    - CANNOT execute trades after session expiration or after user revocation.
 *    - CANNOT withdraw tokens from the vault (withdrawals are strictly user-controlled).
 *
 * 2. MALICIOUS TARGET (DEX / Venue):
 *    - CAN consume gas up to the transaction gas limit.
 *    - CAN perform arbitrary internal state transitions on its own contracts.
 *    - CANNOT pull more than the exact approved amountIn (approvals are exact and
 *      strictly reset to 0 immediately post-call).
 *    - CANNOT reenter AgentGuard (`execute`, `deposit`, and `withdraw` are nonReentrant).
 *    - CANNOT steal tokens without delivering at least `minAmountOut` (post-call balance
 *      checks revert the entire transaction on shortfall).
 *    - CANNOT modify internal vault balances of other tokens or users.
 *
 * 3. MALICIOUS TOKEN:
 *    - CAN charge fees on transfer: AgentGuard handles this safely by measuring actual
 *      onchain balance deltas before and after `transferFrom` on deposit.
 *    - CAN revert on transfers or approvals: AgentGuard fails gracefully without corrupting
 *      internal accounting.
 *    - CANNOT mint unbacked internal vault balances.
 *    - CANNOT drain another user's balance. Reentrant ERC20s are blocked by nonReentrant.
 *
 * 4. MALICIOUS RELAYER:
 *    - CAN submit valid user passkey transactions and pay the transaction gas.
 *    - CAN choose to delay or censor transaction submissions.
 *    - CANNOT forge user passkey signatures (biometrically bound to P256 keypair).
 *    - CANNOT alter transaction payload, amounts, targets, or recipients (challenge hash
 *      cryptographically binds all payload parameters).
 *    - CANNOT replay past actions (enforced by monotonically increasing passkey nonces).
 *    - CANNOT replay actions across chains (`block.chainid` bound into challenge).
 *    - CANNOT replay actions across contracts (`address(this)` bound into challenge).
 *    - CANNOT submit expired authorizations (`deadline` strictly enforced).
 *
 * 5. REPLAYED OR FORGED PASSKEY SIGNATURES:
 *    - CANNOT be forged without the hardware-backed biometric private key.
 *    - CANNOT be replayed due to strict nonce ordering and deadline verification.
 *    - CANNOT exploit ECDSA signature malleability (high-s signatures where s > N/2
 *      are strictly rejected).
 *
 * 6. ERC-8004 IDENTITY REGISTRY:
 *    - IMPORTANT: ERC-8004 registration proves agent identity ownership, NOT trustworthiness.
 *      Registration ensures that `ownerOf(agentId) == agent`, establishing onchain identity
 *      provenance. It does not certify algorithmic reliability. All safety is enforced
 *      deterministically by AgentGuard's policy constraints.
 * ============================================================================
 */
contract AgentGuard is IAgentGuard, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @notice SECP256R1 elliptic curve order N
    uint256 public constant SECP256R1_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    /// @notice SECP256R1 half-order N >> 1 (computed in code to prevent malleability)
    uint256 public constant SECP256R1_N_DIV_2 = SECP256R1_N >> 1;

    /// @notice Typehash for passkey-authorized withdrawals
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256(
        "WithdrawWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    );

    /// @notice Typehash for passkey-authorized session registration
    bytes32 public constant REGISTER_SESSION_TYPEHASH = keccak256(
        "RegisterSessionWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    );

    /// @notice Typehash for passkey-authorized session revocation
    bytes32 public constant REVOKE_SESSION_TYPEHASH = keccak256(
        "RevokeSessionWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    );

    /// @notice ERC-8004 Identity Registry
    IAgentRegistry public registry;

    /// @notice Internal vault balances: balances[user][token]
    mapping(address => mapping(address => uint256)) public balances;

    /// @notice Global allowlist of vetted target venues (owner-managed)
    mapping(address => bool) public approvedTargets;

    /// @notice Active delegation sessions: sessions[user][agent]
    mapping(address => mapping(address => Session)) public sessions;

    /// @notice Per-token spending limits: tokenLimits[user][agent][token]
    mapping(address => mapping(address => mapping(address => TokenLimit))) public tokenLimits;

    /// @notice User-allowed execution targets: allowedTargets[user][agent][target]
    mapping(address => mapping(address => mapping(address => bool))) public allowedTargets;

    /// @notice User-allowed function selectors: allowedSelectors[user][agent][target][selector]
    mapping(address => mapping(address => mapping(address => mapping(bytes4 => bool)))) public allowedSelectors;

    /// @notice Minimum rate floors: minRate[user][agent][tokenIn][tokenOut] (scaled 1e18, raw token units)
    mapping(address => mapping(address => mapping(address => mapping(address => uint256)))) public minRate;

    /// @notice Registered WebAuthn passkey public keys: passkeys[userId]
    mapping(address => Passkey) public passkeys;

    /// @notice Replay protection nonces for passkey accounts: passkeyNonce[userId]
    mapping(address => uint256) public passkeyNonce;

    /// @notice Constructor initializes the owner and the ERC-8004 registry
    /// @param initialOwner Address of contract administrator
    /// @param registryAddress Address of ERC-8004 Identity Registry
    constructor(address initialOwner, address registryAddress) Ownable(initialOwner) {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = IAgentRegistry(registryAddress);
        emit RegistryUpdated(registryAddress);
    }

    // =========================================================================
    // VAULT DEPOSIT & WITHDRAWAL FUNCTIONS
    // =========================================================================

    /// @notice Deposits tokens into the caller's vault balance
    /// @param token Address of ERC20 token to deposit
    /// @param amount Amount of tokens to transfer
    /// @return received The actual token balance credited to the user
    function deposit(address token, uint256 amount) external nonReentrant returns (uint256 received) {
        return _deposit(msg.sender, token, amount);
    }

    /// @notice Deposits tokens credited to a designated user address
    /// @param user Address of the user to credit
    /// @param token Address of ERC20 token to deposit
    /// @param amount Amount of tokens to transfer
    /// @return received The actual token balance credited to the user
    function depositFor(address user, address token, uint256 amount) external nonReentrant returns (uint256 received) {
        if (user == address(0)) revert ZeroAddress();
        return _deposit(user, token, amount);
    }

    /// @dev Internal deposit accounting using balance deltas for fee-on-transfer safety
    function _deposit(address user, address token, uint256 amount) internal returns (uint256 received) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));

        // Credit the actual delta received to guarantee fee-on-transfer safety
        received = balanceAfter - balanceBefore;
        if (received == 0) revert ZeroAmount();

        balances[user][token] += received;
        emit Deposited(user, token, received);
    }

    /// @notice Withdraws tokens by an EOA user (ALWAYS available, even when paused)
    /// @param token Address of ERC20 token to withdraw
    /// @param amount Amount of tokens to withdraw
    /// @param to Recipient address
    function withdraw(address token, uint256 amount, address to) external nonReentrant {
        _withdraw(msg.sender, token, amount, to);
    }

    /// @notice Withdraws tokens using a passkey WebAuthn assertion (ALWAYS available, even when paused)
    /// @param userId Address of the passkey account derived from the P256 public key
    /// @param token Address of ERC20 token to withdraw
    /// @param amount Amount of tokens to withdraw
    /// @param to Recipient address
    /// @param nonce Current replay-protection nonce for the userId
    /// @param deadline Timestamp after which the assertion is invalid
    /// @param auth WebAuthn assertion data
    function withdrawWithPasskey(
        address userId,
        address token,
        uint256 amount,
        address to,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external nonReentrant {
        bytes32 payloadHash = keccak256(abi.encode(token, amount, to));
        _verifyPasskey(userId, WITHDRAW_TYPEHASH, payloadHash, nonce, deadline, auth);
        _withdraw(userId, token, amount, to);
    }

    /// @dev Internal withdrawal accounting
    function _withdraw(address user, address token, uint256 amount, address to) internal {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 userBal = balances[user][token];
        if (userBal < amount) revert InsufficientBalance(userBal, amount);

        balances[user][token] = userBal - amount;
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(user, token, amount, to);
    }

    // =========================================================================
    // PASSKEY & SESSION MANAGEMENT
    // =========================================================================

    /// @notice Registers a P256 public key and derives its deterministic userId
    /// @param qx Public key x-coordinate
    /// @param qy Public key y-coordinate
    /// @return userId The derived passkey account address
    function registerPasskey(uint256 qx, uint256 qy) external returns (address userId) {
        if (qx == 0 || qy == 0) revert InvalidPublicKey();
        userId = address(uint160(uint256(keccak256(abi.encode(qx, qy)))));
        passkeys[userId] = Passkey({qx: qx, qy: qy});
        emit PasskeyRegistered(userId, qx, qy);
    }

    /// @notice Registers an agent trading policy by an EOA caller
    /// @param agent Address of the authorized trading agent
    /// @param agentId ERC-8004 registered agent identity ID
    /// @param expiresAt Expiration timestamp (max 30 days into future)
    /// @param policy The complete trading policy configuration
    function registerSession(address agent, uint256 agentId, uint64 expiresAt, Policy calldata policy)
        external
        whenNotPaused
    {
        _registerSession(msg.sender, agent, agentId, expiresAt, policy);
    }

    /// @notice Registers an agent trading policy via a passkey WebAuthn assertion
    /// @param userId Passkey account address
    /// @param agent Address of the authorized trading agent
    /// @param agentId ERC-8004 registered agent identity ID
    /// @param expiresAt Expiration timestamp
    /// @param policy The complete trading policy configuration
    /// @param nonce Current replay-protection nonce
    /// @param deadline Expiration timestamp of the assertion
    /// @param auth WebAuthn assertion data
    function registerSessionWithPasskey(
        address userId,
        address agent,
        uint256 agentId,
        uint64 expiresAt,
        Policy calldata policy,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external whenNotPaused {
        bytes32 policyHash = _hashPolicy(policy);
        bytes32 payloadHash = keccak256(abi.encode(agent, agentId, expiresAt, policyHash));
        _verifyPasskey(userId, REGISTER_SESSION_TYPEHASH, payloadHash, nonce, deadline, auth);
        _registerSession(userId, agent, agentId, expiresAt, policy);
    }

    /// @dev Internal session registration logic
    function _registerSession(address user, address agent, uint256 agentId, uint64 expiresAt, Policy calldata policy)
        internal
    {
        if (agent == address(0)) revert ZeroAgentAddress();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 30 days) revert InvalidExpiry();

        // Verify agent identity ownership on ERC-8004 registry
        try registry.ownerOf(agentId) returns (address owner) {
            if (owner != agent) revert AgentOwnerMismatch(agentId, agent, owner);
        } catch {
            revert AgentNotRegistered(agentId);
        }

        // Validate and apply target allowlists
        uint256 targetsLen = policy.targets.length;
        for (uint256 i = 0; i < targetsLen; ++i) {
            address target = policy.targets[i];
            if (!approvedTargets[target]) revert TargetNotGloballyApproved(target);
            allowedTargets[user][agent][target] = true;
        }

        // Validate and apply token limits (dailyLimit == 0 means not tradable)
        uint256 tokensLen = policy.tokens.length;
        for (uint256 i = 0; i < tokensLen; ++i) {
            TokenConfig calldata cfg = policy.tokens[i];
            if (cfg.perTradeLimit > cfg.dailyLimit || cfg.dailyLimit == 0) {
                revert InvalidTokenLimit(cfg.token);
            }
            tokenLimits[user][agent][cfg.token] = TokenLimit({
                dailyLimit: cfg.dailyLimit,
                perTradeLimit: cfg.perTradeLimit,
                spentInWindow: 0,
                windowStart: uint64(block.timestamp)
            });
        }

        // Apply allowed function selectors
        uint256 selectorsLen = policy.selectors.length;
        for (uint256 i = 0; i < selectorsLen; ++i) {
            TargetSelector calldata sel = policy.selectors[i];
            allowedSelectors[user][agent][sel.target][sel.selector] = sel.allowed;
        }

        // Apply pair minimum rate floors
        uint256 ratesLen = policy.rates.length;
        for (uint256 i = 0; i < ratesLen; ++i) {
            PairRate calldata r = policy.rates[i];
            minRate[user][agent][r.tokenIn][r.tokenOut] = r.minRate;
        }

        sessions[user][agent] = Session({active: true, expiresAt: expiresAt, agentId: agentId});

        bytes32 policyHash = _hashPolicy(policy);
        emit PolicyCreated(user, agent, agentId, expiresAt, policyHash);
    }

    /// @notice Revokes an agent session by an EOA caller (ALWAYS available, even when paused)
    /// @param agent Address of the agent to revoke
    function revokeSession(address agent) external {
        sessions[msg.sender][agent].active = false;
        emit SessionRevoked(msg.sender, agent);
    }

    /// @notice Revokes an agent session via a passkey WebAuthn assertion (ALWAYS available, even when paused)
    /// @param userId Passkey account address
    /// @param agent Address of the agent to revoke
    /// @param nonce Current replay-protection nonce
    /// @param deadline Expiration timestamp of the assertion
    /// @param auth WebAuthn assertion data
    function revokeSessionWithPasskey(
        address userId,
        address agent,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) external {
        bytes32 payloadHash = keccak256(abi.encode(agent));
        _verifyPasskey(userId, REVOKE_SESSION_TYPEHASH, payloadHash, nonce, deadline, auth);
        sessions[userId][agent].active = false;
        emit SessionRevoked(userId, agent);
    }

    // =========================================================================
    // EXECUTION ENGINE
    // =========================================================================

    /// @notice Executes a trade on behalf of a user inside authorized policy limits
    /// @param p Parameters for trade execution
    /// @return success True if executed successfully; returns false on policy violations without reverting
    function execute(ExecuteParams calldata p) external nonReentrant whenNotPaused returns (bool success) {
        address agent = msg.sender;

        // Perform pre-call policy enforcement checks
        if (!_validatePreCall(p, agent)) {
            return false;
        }

        // Execute the venue interaction and assert post-call safety bounds
        (uint256 spent, uint256 received) = _performTrade(p);

        // Update internal vault balances and rolling window expenditure
        balances[p.user][p.tokenIn] -= spent;
        balances[p.user][p.tokenOut] += received;
        tokenLimits[p.user][agent][p.tokenIn].spentInWindow += uint128(spent);

        emit ActionExecuted(p.user, agent, p.target, p.tokenIn, p.tokenOut, spent, received, p.decisionHash);

        return true;
    }

    /// @dev Validates all pre-call policy checks; returns false and emits PolicyViolation on failure
    function _validatePreCall(ExecuteParams calldata p, address agent) internal returns (bool) {
        // 1. Bad pair check: cannot trade same token, and target cannot be the guard or tokens
        if (p.tokenIn == p.tokenOut || p.target == address(this) || p.target == p.tokenIn || p.target == p.tokenOut) {
            emit PolicyViolation(p.user, agent, ReasonCode.BAD_PAIR, p.decisionHash);
            return false;
        }

        // 2. Active session check
        Session storage session = sessions[p.user][agent];
        if (!session.active) {
            emit PolicyViolation(p.user, agent, ReasonCode.NO_SESSION, p.decisionHash);
            return false;
        }

        // 3. Expiration check
        if (block.timestamp > session.expiresAt) {
            emit PolicyViolation(p.user, agent, ReasonCode.EXPIRED, p.decisionHash);
            return false;
        }

        // 4. Target allowlist check (must be user-allowed and globally approved)
        if (!allowedTargets[p.user][agent][p.target] || !approvedTargets[p.target]) {
            emit PolicyViolation(p.user, agent, ReasonCode.TARGET_NOT_ALLOWED, p.decisionHash);
            return false;
        }

        // 5. Function selector check
        if (p.data.length < 4) {
            emit PolicyViolation(p.user, agent, ReasonCode.SELECTOR_NOT_ALLOWED, p.decisionHash);
            return false;
        }
        bytes4 selector = bytes4(p.data[:4]);
        if (!allowedSelectors[p.user][agent][p.target][selector]) {
            emit PolicyViolation(p.user, agent, ReasonCode.SELECTOR_NOT_ALLOWED, p.decisionHash);
            return false;
        }

        // 6. Token allowlist check (dailyLimit == 0 means not tradable)
        TokenLimit storage limit = tokenLimits[p.user][agent][p.tokenIn];
        if (limit.dailyLimit == 0) {
            emit PolicyViolation(p.user, agent, ReasonCode.TOKEN_NOT_ALLOWED, p.decisionHash);
            return false;
        }

        // 7. Per-trade cap check
        if (p.amountIn > limit.perTradeLimit) {
            emit PolicyViolation(p.user, agent, ReasonCode.EXCEEDS_PER_TRADE, p.decisionHash);
            return false;
        }

        // 8. Rolling daily window calculation
        if (block.timestamp >= uint256(limit.windowStart) + 1 days) {
            limit.spentInWindow = 0;
            limit.windowStart = uint64(block.timestamp);
        }

        // 9. Daily budget cap check
        if (uint256(limit.spentInWindow) + p.amountIn > uint256(limit.dailyLimit)) {
            emit PolicyViolation(p.user, agent, ReasonCode.EXCEEDS_DAILY, p.decisionHash);
            return false;
        }

        // 10. Vault balance check
        if (balances[p.user][p.tokenIn] < p.amountIn) {
            emit PolicyViolation(p.user, agent, ReasonCode.INSUFFICIENT_BALANCE, p.decisionHash);
            return false;
        }

        return true;
    }

    /// @dev Performs low-level call to target venue and verifies post-call balance invariants
    function _performTrade(ExecuteParams calldata p) internal returns (uint256 spent, uint256 received) {
        uint256 balanceInBefore = IERC20(p.tokenIn).balanceOf(address(this));
        uint256 balanceOutBefore = IERC20(p.tokenOut).balanceOf(address(this));

        // Exact approval to target, immediately reset to 0 post-call
        IERC20(p.tokenIn).forceApprove(p.target, p.amountIn);
        (bool callSuccess,) = p.target.call(p.data);
        IERC20(p.tokenIn).forceApprove(p.target, 0);

        if (!callSuccess) revert CallFailed();

        // Strict post-call invariants
        uint256 balanceInAfter = IERC20(p.tokenIn).balanceOf(address(this));
        if (balanceInAfter > balanceInBefore) revert CallFailed();

        spent = balanceInBefore - balanceInAfter;
        if (spent > p.amountIn) revert SpentMoreThanAuthorized();

        uint256 balanceOutAfter = IERC20(p.tokenOut).balanceOf(address(this));
        if (balanceOutAfter < balanceOutBefore) revert SlippageExceeded();

        received = balanceOutAfter - balanceOutBefore;
        if (received < p.minAmountOut || received == 0) revert SlippageExceeded();

        // Minimum rate floor check (1e18 scaled, raw units)
        uint256 floorRate = minRate[p.user][msg.sender][p.tokenIn][p.tokenOut];
        if (floorRate > 0) {
            if (received * 1e18 < spent * floorRate) revert BelowUserRateFloor();
        }
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /// @notice Sets global approval status for a venue/target contract
    /// @param target The contract address to approve or revoke
    /// @param approved Global approval boolean
    function setApprovedTarget(address target, bool approved) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        approvedTargets[target] = approved;
        emit TargetApprovalUpdated(target, approved);
    }

    /// @notice Updates the ERC-8004 Identity Registry contract
    /// @param newRegistry Address of new ERC-8004 registry
    function setRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert ZeroAddress();
        registry = IAgentRegistry(newRegistry);
        emit RegistryUpdated(newRegistry);
    }

    /// @notice Pauses execute and registerSession (withdraw and revoke are never paused)
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses contract operations
    function unpause() external onlyOwner {
        _unpause();
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /// @notice Returns session information for a given user and agent
    function getSession(address user, address agent) external view returns (Session memory) {
        return sessions[user][agent];
    }

    /// @notice Returns token limit policy for a user, agent, and token
    function getLimit(address user, address agent, address token) external view returns (TokenLimit memory) {
        return tokenLimits[user][agent][token];
    }

    /// @notice Calculates remaining budget in the current 24-hour window
    function windowRemaining(address user, address agent, address token)
        external
        view
        returns (uint128 remainingBudget, uint64 secondsUntilReset)
    {
        TokenLimit memory limit = tokenLimits[user][agent][token];
        if (limit.dailyLimit == 0) {
            return (0, 0);
        }

        if (block.timestamp >= uint256(limit.windowStart) + 1 days) {
            return (limit.dailyLimit, 0);
        }

        uint128 spent = limit.spentInWindow;
        remainingBudget = spent >= limit.dailyLimit ? 0 : limit.dailyLimit - spent;
        secondsUntilReset = uint64((uint256(limit.windowStart) + 1 days) - block.timestamp);
    }

    /// @notice Returns the registered passkey public key for a userId
    function passkeyOf(address userId) external view returns (Passkey memory) {
        return passkeys[userId];
    }

    /// @notice Returns the next expected nonce for a passkey account
    function nextNonce(address userId) external view returns (uint256) {
        return passkeyNonce[userId];
    }

    // =========================================================================
    // INTERNAL HELPER FUNCTIONS
    // =========================================================================

    /// @dev Verifies a WebAuthn passkey assertion for a userId
    function _verifyPasskey(
        address userId,
        bytes32 actionTypehash,
        bytes32 payloadHash,
        uint256 nonce,
        uint256 deadline,
        WebAuthn.WebAuthnAuth calldata auth
    ) internal {
        Passkey memory pk = passkeys[userId];
        if (pk.qx == 0 && pk.qy == 0) revert PasskeyNotRegistered();

        if (block.timestamp > deadline) revert DeadlineExpired();
        if (nonce != passkeyNonce[userId]) revert InvalidNonce();

        // Increment nonce monotonically for replay protection
        passkeyNonce[userId] = nonce + 1;

        // Enforce low-s (prevent signature malleability, s <= N/2)
        if (uint256(auth.s) == 0 || uint256(auth.s) > SECP256R1_N_DIV_2) {
            revert InvalidSignatureS();
        }
        if (uint256(auth.r) == 0 || uint256(auth.r) >= SECP256R1_N) {
            revert InvalidSignatureR();
        }

        // Reconstruct expected challenge hash
        bytes32 challenge =
            keccak256(abi.encode(actionTypehash, block.chainid, address(this), userId, payloadHash, nonce, deadline));

        // Verify WebAuthn assertion requiring User Verification (UV flag)
        bool verified = WebAuthn.verify(
            abi.encodePacked(challenge),
            true, // requireUserVerification = true
            auth,
            bytes32(pk.qx),
            bytes32(pk.qy)
        );

        if (!verified) revert WebAuthnVerificationFailed();
    }

    /// @dev Computes a deterministic hash of the trading policy
    function _hashPolicy(Policy calldata policy) internal pure returns (bytes32) {
        bytes32 tokensHash = keccak256(abi.encode(policy.tokens));
        bytes32 targetsHash = keccak256(abi.encode(policy.targets));
        bytes32 selectorsHash = keccak256(abi.encode(policy.selectors));
        bytes32 ratesHash = keccak256(abi.encode(policy.rates));
        return keccak256(abi.encode(tokensHash, targetsHash, selectorsHash, ratesHash));
    }
}
