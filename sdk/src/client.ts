/**
 * Aegis-Monad Client
 * Developer-facing SDK client providing typed reads and writes for Aegis-Monad smart vaults.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  encodeAbiParameters,
  keccak256,
} from "viem";
import {
  AGENT_GUARD_ABI,
  ERC20_ABI,
  ERC8004_REGISTRY_ABI,
  DEPLOYED_ADDRESSES,
} from "./contracts/generated.js";
import {
  type PolicyConfig,
  computePolicyHash,
  toOnchainPolicy,
} from "./policy.js";
import {
  type WebAuthnAuth,
  buildChallenge,
  computeRegisterSessionPayloadHash,
  deriveUserId,
  signWithPasskey,
} from "./passkey.js";

export interface AegisClientConfig {
  /** Viem PublicClient connected to Monad testnet or fork. */
  readonly publicClient: PublicClient;
  /** Optional Viem WalletClient for executing transactions (required for write methods). */
  readonly walletClient?: WalletClient;
  /** Address of deployed AgentGuard contract (defaults to testnet deployment). */
  readonly guardAddress?: Address;
  /** Address of ERC-8004 Agent Identity Registry contract (defaults to testnet deployment). */
  readonly registryAddress?: Address;
}

export interface SessionInfo {
  readonly active: boolean;
  readonly expiresAt: bigint;
  readonly agentId: bigint;
}

export interface TokenLimitInfo {
  readonly dailyLimit: bigint;
  readonly perTradeLimit: bigint;
  readonly spentInWindow: bigint;
  readonly windowStart: bigint;
}

export interface WindowRemainingInfo {
  readonly remainingBudget: bigint;
  readonly secondsUntilReset: bigint;
}

export interface PasskeyInfo {
  readonly qx: bigint;
  readonly qy: bigint;
}

/**
 * AegisClient provides high-level typed interaction with AgentGuard on Monad.
 */
export class AegisClient {
  public readonly publicClient: PublicClient;
  public readonly walletClient?: WalletClient;
  public readonly guardAddress: Address;
  public readonly registryAddress: Address;

  constructor(config: AegisClientConfig) {
    this.publicClient = config.publicClient;
    this.walletClient = config.walletClient;
    this.guardAddress = config.guardAddress ?? DEPLOYED_ADDRESSES.agentGuard;
    this.registryAddress = config.registryAddress ?? DEPLOYED_ADDRESSES.registry;
  }

  private requireWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error("WalletClient is required for write operations on AegisClient.");
    }
    return this.walletClient;
  }

  // =========================================================================
  // TYPED READ METHODS
  // =========================================================================

  /**
   * Fetches session information for a given user and agent.
   *
   * @param user - User EOA or passkey userId address
   * @param agent - Authorized agent address
   * @returns Session state { active, expiresAt, agentId }
   */
  public async getSession(user: Address, agent: Address): Promise<SessionInfo> {
    const data = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "getSession",
      args: [user, agent],
    });
    return {
      active: data.active,
      expiresAt: BigInt(data.expiresAt),
      agentId: BigInt(data.agentId),
    };
  }

  /**
   * Retrieves the token limit policy for a user, agent, and token.
   *
   * @param user - User address
   * @param agent - Agent address
   * @param token - ERC20 token address
   * @returns Limit configuration and current rolling window metrics
   */
  public async getLimit(
    user: Address,
    agent: Address,
    token: Address
  ): Promise<TokenLimitInfo> {
    const data = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "getLimit",
      args: [user, agent, token],
    });
    return {
      dailyLimit: BigInt(data.dailyLimit),
      perTradeLimit: BigInt(data.perTradeLimit),
      spentInWindow: BigInt(data.spentInWindow),
      windowStart: BigInt(data.windowStart),
    };
  }

  /**
   * Calculates the remaining spending budget and seconds until rolling window reset.
   *
   * @param user - User address
   * @param agent - Agent address
   * @param token - ERC20 token address
   * @returns { remainingBudget, secondsUntilReset }
   */
  public async windowRemaining(
    user: Address,
    agent: Address,
    token: Address
  ): Promise<WindowRemainingInfo> {
    const [remainingBudget, secondsUntilReset] = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "windowRemaining",
      args: [user, agent, token],
    });
    return {
      remainingBudget: BigInt(remainingBudget),
      secondsUntilReset: BigInt(secondsUntilReset),
    };
  }

  /**
   * Reads a user's internal vault balance for an ERC20 token inside AgentGuard.
   *
   * @param user - User EOA or passkey userId
   * @param token - ERC20 token address
   * @returns Vault balance in base token units
   */
  public async balanceOf(user: Address, token: Address): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "balances",
      args: [user, token],
    });
    return BigInt(balance);
  }

  /**
   * Retrieves registered passkey P256 coordinates for a passkey account.
   *
   * @param userId - Deterministic passkey account address
   * @returns { qx, qy } coordinates
   */
  public async passkeyOf(userId: Address): Promise<PasskeyInfo> {
    const data = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "passkeyOf",
      args: [userId],
    });
    return {
      qx: BigInt(data.qx),
      qy: BigInt(data.qy),
    };
  }

  /**
   * Fetches the next expected replay-protection nonce for a passkey account.
   *
   * @param userId - Passkey account address
   * @returns Current expected nonce
   */
  public async nextNonce(userId: Address): Promise<bigint> {
    const nonce = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "nextNonce",
      args: [userId],
    });
    return BigInt(nonce);
  }

  /**
   * Checks whether a trading venue contract is globally approved on AgentGuard.
   *
   * @param target - Venue or DEX contract address
   * @returns True if target is globally approved
   */
  public async isTargetApproved(target: Address): Promise<boolean> {
    const approved = await this.publicClient.readContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "approvedTargets",
      args: [target],
    });
    return Boolean(approved);
  }

  /**
   * Resolves the controller address of an ERC-8004 agent identity ID.
   *
   * @param agentId - ERC-8004 token ID
   * @returns Controller EOA address
   */
  public async getAgentOwner(agentId: bigint): Promise<Address> {
    const owner = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: ERC8004_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    });
    return owner;
  }

  // =========================================================================
  // TYPED WRITE METHODS (EOA / MERA-DERIVED PATH)
  // =========================================================================

  /**
   * Deposits tokens into the caller's AgentGuard vault.
   * Automatically handles ERC20 approval if existing allowance is insufficient.
   *
   * @param token - ERC20 token address
   * @param amount - Deposit amount in token base units
   * @returns Transaction hash of the deposit
   */
  public async deposit(token: Address, amount: bigint): Promise<Hex> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    // Check existing allowance
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, this.guardAddress],
    });

    if (allowance < amount) {
      const approveHash = await wallet.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [this.guardAddress, amount],
        chain: wallet.chain,
        account,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const txHash = await wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "deposit",
      args: [token, amount],
      chain: wallet.chain,
      account,
    });
    return txHash;
  }

  /**
   * Deposits tokens credited to a designated user address (e.g. funding a passkey vault).
   * Automatically handles ERC20 approval if existing allowance is insufficient.
   *
   * @param user - Recipient user or passkey account address
   * @param token - ERC20 token address
   * @param amount - Deposit amount in base units
   * @returns Transaction hash
   */
  public async depositFor(user: Address, token: Address, amount: bigint): Promise<Hex> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const allowance = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, this.guardAddress],
    });

    if (allowance < amount) {
      const approveHash = await wallet.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [this.guardAddress, amount],
        chain: wallet.chain,
        account,
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const txHash = await wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "depositFor",
      args: [user, token, amount],
      chain: wallet.chain,
      account,
    });
    return txHash;
  }

  /**
   * Withdraws tokens from the caller's vault back to an address.
   *
   * @param token - ERC20 token address
   * @param amount - Amount to withdraw
   * @param to - Recipient address
   * @returns Transaction hash
   */
  public async withdraw(token: Address, amount: bigint, to: Address): Promise<Hex> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "withdraw",
      args: [token, amount, to],
      chain: wallet.chain,
      account,
    });
  }

  /**
   * Registers an agent trading policy by an EOA caller.
   *
   * @param policy - Validated policy configuration
   * @returns Transaction hash
   */
  public async registerSession(policy: PolicyConfig): Promise<Hex> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const onchainPolicy = toOnchainPolicy(policy);
    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "registerSession",
      args: [policy.agent, policy.agentId, policy.expiresAt, onchainPolicy as any],
      chain: wallet.chain,
      account,
    });
  }

  /**
   * High-level convenience helper: registers an agent policy and waits for onchain confirmation.
   *
   * @param policy - Validated policy configuration
   * @returns Object containing transaction hash and confirmed receipt
   */
  public async grantAgent(
    policy: PolicyConfig
  ): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
    const hash = await this.registerSession(policy);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  }

  /**
   * Revokes an agent trading session by an EOA caller.
   *
   * @param agent - Agent address to revoke
   * @returns Transaction hash
   */
  public async revokeSession(agent: Address): Promise<Hex> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "revokeSession",
      args: [agent],
      chain: wallet.chain,
      account,
    });
  }

  // =========================================================================
  // TYPED WRITE METHODS (WEBAUTHN PASSKEY PATH)
  // =========================================================================

  /**
   * Registers a P256 public key onchain and derives its deterministic userId.
   * Can be submitted by the user or an upfront relayer.
   *
   * @param qx - P256 public key x-coordinate
   * @param qy - P256 public key y-coordinate
   * @returns { txHash, userId }
   */
  public async registerPasskey(
    qx: bigint,
    qy: bigint
  ): Promise<{ txHash: Hex; userId: Address }> {
    const wallet = this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const txHash = await wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "registerPasskey",
      args: [qx, qy],
      chain: wallet.chain,
      account,
    });
    const userId = deriveUserId(qx, qy);
    return { txHash, userId };
  }

  /**
   * Submits a passkey WebAuthn assertion to register an agent trading session.
   * Can either accept an already-signed WebAuthnAuth struct, or automatically fetch nonce,
   * construct challenge, request browser passkey signature, and submit via relayer.
   */
  public async registerSessionWithPasskey(params: {
    userId: Address;
    agent: Address;
    agentId: bigint;
    expiresAt: bigint;
    policy: PolicyConfig;
    nonce?: bigint;
    deadline?: bigint;
    auth?: WebAuthnAuth;
    relayerWalletClient?: WalletClient;
  }): Promise<Hex> {
    const wallet = params.relayerWalletClient ?? this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const nonce = params.nonce ?? (await this.nextNonce(params.userId));
    const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = BigInt(wallet.chain?.id ?? (await this.publicClient.getChainId()));

    let auth = params.auth;
    if (!auth) {
      const policyHash = computePolicyHash(params.policy);
      const payloadHash = computeRegisterSessionPayloadHash(
        params.agent,
        params.agentId,
        params.expiresAt,
        policyHash
      );
      const challenge = buildChallenge(
        "REGISTER_SESSION",
        params.userId,
        payloadHash,
        nonce,
        deadline,
        this.guardAddress,
        chainId
      );
      auth = await signWithPasskey(challenge);
    }

    const onchainPolicy = toOnchainPolicy(params.policy);
    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "registerSessionWithPasskey",
      args: [
        params.userId,
        params.agent,
        params.agentId,
        params.expiresAt,
        onchainPolicy as any,
        nonce,
        deadline,
        auth,
      ],
      chain: wallet.chain,
      account,
    });
  }

  /**
   * Submits a passkey WebAuthn assertion to revoke an active session.
   * If auth is omitted, automatically fetches nonce, requests browser passkey signature, and relays.
   */
  public async revokeSessionWithPasskey(params: {
    userId: Address;
    agent: Address;
    nonce?: bigint;
    deadline?: bigint;
    auth?: WebAuthnAuth;
    relayerWalletClient?: WalletClient;
  }): Promise<Hex> {
    const wallet = params.relayerWalletClient ?? this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const nonce = params.nonce ?? (await this.nextNonce(params.userId));
    const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = BigInt(wallet.chain?.id ?? (await this.publicClient.getChainId()));

    let auth = params.auth;
    if (!auth) {
      const payloadHash = keccak256(encodeAbiParameters([{ type: "address" }], [params.agent]));
      const challenge = buildChallenge(
        "REVOKE_SESSION",
        params.userId,
        payloadHash,
        nonce,
        deadline,
        this.guardAddress,
        chainId
      );
      auth = await signWithPasskey(challenge);
    }

    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "revokeSessionWithPasskey",
      args: [params.userId, params.agent, nonce, deadline, auth],
      chain: wallet.chain,
      account,
    });
  }

  /**
   * Alias for revokeSessionWithPasskey matching spec naming.
   */
  public async revokeWithPasskey(params: {
    userId: Address;
    agent: Address;
    nonce?: bigint;
    deadline?: bigint;
    auth?: WebAuthnAuth;
    relayerWalletClient?: WalletClient;
  }): Promise<Hex> {
    return this.revokeSessionWithPasskey(params);
  }

  /**
   * Submits a passkey WebAuthn assertion to withdraw vault funds to a recipient EOA.
   * If auth is omitted, automatically fetches nonce, requests browser passkey signature, and relays.
   */
  public async withdrawWithPasskey(params: {
    userId: Address;
    token: Address;
    amount: bigint;
    to: Address;
    nonce?: bigint;
    deadline?: bigint;
    auth?: WebAuthnAuth;
    relayerWalletClient?: WalletClient;
  }): Promise<Hex> {
    const wallet = params.relayerWalletClient ?? this.requireWalletClient();
    const account = wallet.account;
    if (!account) throw new Error("WalletClient has no active account configured.");

    const nonce = params.nonce ?? (await this.nextNonce(params.userId));
    const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = BigInt(wallet.chain?.id ?? (await this.publicClient.getChainId()));

    let auth = params.auth;
    if (!auth) {
      const payloadHash = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "address" }],
          [params.token, params.amount, params.to]
        )
      );
      const challenge = buildChallenge(
        "WITHDRAW",
        params.userId,
        payloadHash,
        nonce,
        deadline,
        this.guardAddress,
        chainId
      );
      auth = await signWithPasskey(challenge);
    }

    return wallet.writeContract({
      address: this.guardAddress,
      abi: AGENT_GUARD_ABI,
      functionName: "withdrawWithPasskey",
      args: [
        params.userId,
        params.token,
        params.amount,
        params.to,
        nonce,
        deadline,
        auth,
      ],
      chain: wallet.chain,
      account,
    });
  }
}

/**
 * Factory helper function to instantiate an AegisClient.
 */
export function createAegisClient(config: AegisClientConfig): AegisClient {
  return new AegisClient(config);
}
