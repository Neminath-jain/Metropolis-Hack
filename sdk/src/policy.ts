/**
 * Aegis-Monad Policy Builder and Validator
 * Constructs, validates, and hashes trading delegation policies matching AgentGuard.sol.
 */

import {
  type Address,
  type Hex,
  encodeAbiParameters,
  isAddress,
  isHex,
  keccak256,
  size,
  zeroAddress,
} from "viem";

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(`[Aegis Policy Error] ${message}`);
    this.name = "PolicyValidationError";
  }
}

/** Configuration for token spending limits. */
export interface TokenLimitConfig {
  /** ERC20 token address. */
  readonly token: Address;
  /** 24-hour rolling expenditure cap in base units. */
  readonly dailyLimit: bigint;
  /** Maximum single trade expenditure cap in base units. */
  readonly perTradeLimit: bigint;
}

/** Configuration for allowed venue function selectors. */
export interface TargetSelectorConfig {
  /** Target venue contract address. */
  readonly target: Address;
  /** 4-byte function selector (e.g. 0x022c0d9f). */
  readonly selector: Hex;
  /** Authorization status. */
  readonly allowed: boolean;
}

/** Configuration for pair rate exchange floors. */
export interface PairRateConfig {
  /** Inbound trading token. */
  readonly tokenIn: Address;
  /** Outbound trading token. */
  readonly tokenOut: Address;
  /** Minimum exchange rate floor in 1e18 scale. */
  readonly minRate: bigint;
}

/** Complete delegation policy representation. */
export interface PolicyConfig {
  /** Authorized agent controller address. */
  readonly agent: Address;
  /** ERC-8004 identity token ID for the agent. */
  readonly agentId: bigint;
  /** Expiration timestamp in UNIX seconds. */
  readonly expiresAt: bigint;
  /** List of token limits. */
  readonly tokens: readonly TokenLimitConfig[];
  /** List of allowed venue target contracts. */
  readonly targets: readonly Address[];
  /** List of allowed venue function selectors. */
  readonly selectors: readonly TargetSelectorConfig[];
  /** List of pair minimum exchange rate floors. */
  readonly rates: readonly PairRateConfig[];
}

/** Raw onchain policy tuple as required by AgentGuard.sol ABI. */
export interface OnchainPolicy {
  readonly tokens: readonly {
    readonly token: Address;
    readonly dailyLimit: bigint;
    readonly perTradeLimit: bigint;
  }[];
  readonly targets: readonly Address[];
  readonly selectors: readonly {
    readonly target: Address;
    readonly selector: Hex;
    readonly allowed: boolean;
  }[];
  readonly rates: readonly {
    readonly tokenIn: Address;
    readonly tokenOut: Address;
    readonly minRate: bigint;
  }[];
}

export const MAX_SESSION_DURATION_SECONDS = 30n * 86400n; // 30 days

/**
 * Validates a policy against AgentGuard's onchain constraints.
 * Fails early with clear descriptive errors.
 *
 * @param policy - Policy configuration to validate
 * @param currentTimeSeconds - Optional current time in seconds (defaults to now)
 */
export function validatePolicy(
  policy: PolicyConfig,
  currentTimeSeconds: bigint = BigInt(Math.floor(Date.now() / 1000))
): void {
  if (!policy.agent || !isAddress(policy.agent) || policy.agent === zeroAddress) {
    throw new PolicyValidationError("Agent address must be a valid, non-zero address.");
  }

  if (policy.agentId < 0n) {
    throw new PolicyValidationError("Agent ID must be a non-negative integer.");
  }

  if (policy.expiresAt <= currentTimeSeconds) {
    throw new PolicyValidationError(
      `Session expiry (${policy.expiresAt}) must be in the future (current: ${currentTimeSeconds}).`
    );
  }

  if (policy.expiresAt > currentTimeSeconds + MAX_SESSION_DURATION_SECONDS) {
    throw new PolicyValidationError(
      `Session expiry exceeds maximum allowed duration of 30 days (${policy.expiresAt} > ${currentTimeSeconds + MAX_SESSION_DURATION_SECONDS}).`
    );
  }

  if (!policy.tokens || policy.tokens.length === 0) {
    throw new PolicyValidationError("Policy must define at least one tradable token configuration.");
  }

  for (const t of policy.tokens) {
    if (!t.token || !isAddress(t.token) || t.token === zeroAddress) {
      throw new PolicyValidationError("Token address must be a valid non-zero address.");
    }
    if (t.dailyLimit <= 0n) {
      throw new PolicyValidationError(`Daily limit for token ${t.token} must be greater than zero.`);
    }
    if (t.perTradeLimit <= 0n) {
      throw new PolicyValidationError(`Per-trade limit for token ${t.token} must be greater than zero.`);
    }
    if (t.perTradeLimit > t.dailyLimit) {
      throw new PolicyValidationError(
        `Per-trade limit (${t.perTradeLimit}) cannot exceed daily limit (${t.dailyLimit}) for token ${t.token}.`
      );
    }
  }

  if (!policy.targets || policy.targets.length === 0) {
    throw new PolicyValidationError("Policy must define at least one allowed target venue.");
  }

  for (const target of policy.targets) {
    if (!target || !isAddress(target) || target === zeroAddress) {
      throw new PolicyValidationError("Target venue must be a valid non-zero address.");
    }
  }

  for (const s of policy.selectors) {
    if (!s.target || !isAddress(s.target) || s.target === zeroAddress) {
      throw new PolicyValidationError("Target selector contract must be a valid non-zero address.");
    }
    if (!s.selector || !isHex(s.selector) || size(s.selector) !== 4) {
      throw new PolicyValidationError(
        `Invalid function selector ${s.selector} for target ${s.target}. Must be 4 bytes (e.g. 0x022c0d9f).`
      );
    }
  }

  for (const r of policy.rates) {
    if (!r.tokenIn || !isAddress(r.tokenIn) || r.tokenIn === zeroAddress) {
      throw new PolicyValidationError("Rate tokenIn must be a valid non-zero address.");
    }
    if (!r.tokenOut || !isAddress(r.tokenOut) || r.tokenOut === zeroAddress) {
      throw new PolicyValidationError("Rate tokenOut must be a valid non-zero address.");
    }
    if (r.tokenIn.toLowerCase() === r.tokenOut.toLowerCase()) {
      throw new PolicyValidationError(`Rate tokenIn and tokenOut cannot be identical: ${r.tokenIn}.`);
    }
    if (r.minRate <= 0n) {
      throw new PolicyValidationError("Minimum rate floor must be greater than zero.");
    }
  }
}

/**
 * Computes deterministic policy hash matching AgentGuard._hashPolicy EXACTLY:
 * keccak256(abi.encode(
 *   keccak256(abi.encode(policy.tokens)),
 *   keccak256(abi.encode(policy.targets)),
 *   keccak256(abi.encode(policy.selectors)),
 *   keccak256(abi.encode(policy.rates))
 * ))
 *
 * @param policy - Policy configuration or onchain policy struct
 * @returns 32-byte hexadecimal hash
 */
export function computePolicyHash(
  policy: Pick<PolicyConfig, "tokens" | "targets" | "selectors" | "rates">
): Hex {
  const tokensHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "token", type: "address" },
            { name: "dailyLimit", type: "uint128" },
            { name: "perTradeLimit", type: "uint128" },
          ],
        },
      ],
      [
        policy.tokens.map((t) => ({
          token: t.token,
          dailyLimit: t.dailyLimit,
          perTradeLimit: t.perTradeLimit,
        })),
      ]
    )
  );

  const targetsHash = keccak256(
    encodeAbiParameters([{ type: "address[]" }], [policy.targets as Address[]])
  );

  const selectorsHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "target", type: "address" },
            { name: "selector", type: "bytes4" },
            { name: "allowed", type: "bool" },
          ],
        },
      ],
      [
        policy.selectors.map((s) => ({
          target: s.target,
          selector: s.selector,
          allowed: s.allowed,
        })),
      ]
    )
  );

  const ratesHash = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "minRate", type: "uint256" },
          ],
        },
      ],
      [
        policy.rates.map((r) => ({
          tokenIn: r.tokenIn,
          tokenOut: r.tokenOut,
          minRate: r.minRate,
        })),
      ]
    )
  );

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [tokensHash, targetsHash, selectorsHash, ratesHash]
    )
  );
}

/**
 * Converts a PolicyConfig into the onchain struct format expected by AgentGuard.
 */
export function toOnchainPolicy(policy: PolicyConfig): OnchainPolicy {
  validatePolicy(policy);
  return {
    tokens: policy.tokens.map((t) => ({
      token: t.token,
      dailyLimit: t.dailyLimit,
      perTradeLimit: t.perTradeLimit,
    })),
    targets: [...policy.targets],
    selectors: policy.selectors.map((s) => ({
      target: s.target,
      selector: s.selector,
      allowed: s.allowed,
    })),
    rates: policy.rates.map((r) => ({
      tokenIn: r.tokenIn,
      tokenOut: r.tokenOut,
      minRate: r.minRate,
    })),
  };
}

/**
 * Fluent builder for constructing AgentGuard delegation policies.
 */
export class PolicyBuilder {
  private agent: Address = zeroAddress;
  private agentId: bigint = 0n;
  private expiresAt: bigint = 0n;
  private tokens: TokenLimitConfig[] = [];
  private targets: Address[] = [];
  private selectors: TargetSelectorConfig[] = [];
  private rates: PairRateConfig[] = [];

  constructor(agent?: Address, agentId?: bigint, durationSeconds: bigint = 7n * 86400n) {
    if (agent) this.agent = agent;
    if (agentId !== undefined) this.agentId = agentId;
    this.expiresAt = BigInt(Math.floor(Date.now() / 1000)) + durationSeconds;
  }

  public setAgent(agent: Address, agentId: bigint): this {
    this.agent = agent;
    this.agentId = agentId;
    return this;
  }

  public setExpiry(timestamp: bigint): this {
    this.expiresAt = timestamp;
    return this;
  }

  public setDuration(seconds: bigint): this {
    this.expiresAt = BigInt(Math.floor(Date.now() / 1000)) + seconds;
    return this;
  }

  public allowToken(token: Address, dailyLimit: bigint, perTradeLimit: bigint): this {
    this.tokens.push({ token, dailyLimit, perTradeLimit });
    return this;
  }

  public allowTarget(target: Address): this {
    if (!this.targets.includes(target)) {
      this.targets.push(target);
    }
    return this;
  }

  public allowSelector(target: Address, selector: Hex, allowed: boolean = true): this {
    this.allowTarget(target);
    this.selectors.push({ target, selector, allowed });
    return this;
  }

  public setMinRate(tokenIn: Address, tokenOut: Address, minRate: bigint): this {
    this.rates.push({ tokenIn, tokenOut, minRate });
    return this;
  }

  public build(): PolicyConfig {
    const policy: PolicyConfig = {
      agent: this.agent,
      agentId: this.agentId,
      expiresAt: this.expiresAt,
      tokens: [...this.tokens],
      targets: [...this.targets],
      selectors: [...this.selectors],
      rates: [...this.rates],
    };
    validatePolicy(policy);
    return policy;
  }
}
