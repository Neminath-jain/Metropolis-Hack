import { describe, it, expect } from "vitest";
import {
  PolicyBuilder,
  PolicyValidationError,
  computePolicyHash,
  validatePolicy,
} from "../src/policy.js";
import { VENUE_SELECTORS } from "../src/contracts/generated.js";
import type { PolicyConfig } from "../src/policy.js";

describe("Policy Builder & Validator", () => {
  const sampleAgent = "0x0000000000000000000000000000000000000040";
  const tokenA = "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9";
  const tokenB = "0xc7183455a4C133Ae270771860664b6B7ec320bB1";
  const venue = "0x1d1499e622D69689cdf9004d05Ec547d650Ff211";
  const selector = VENUE_SELECTORS.swap;

  it("validates a well-formed policy successfully", () => {
    const policy: PolicyConfig = {
      agent: sampleAgent,
      agentId: 1n,
      expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      tokens: [{ token: tokenA, dailyLimit: 100n * 10n ** 18n, perTradeLimit: 20n * 10n ** 18n }],
      targets: [venue],
      selectors: [{ target: venue, selector, allowed: true }],
      rates: [{ tokenIn: tokenA, tokenOut: tokenB, minRate: 10n ** 18n }],
    };

    expect(() => validatePolicy(policy)).not.toThrow();
  });

  it("rejects policy when perTradeLimit exceeds dailyLimit", () => {
    const policy: PolicyConfig = {
      agent: sampleAgent,
      agentId: 1n,
      expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      tokens: [{ token: tokenA, dailyLimit: 10n * 10n ** 18n, perTradeLimit: 20n * 10n ** 18n }],
      targets: [venue],
      selectors: [{ target: venue, selector, allowed: true }],
      rates: [],
    };

    expect(() => validatePolicy(policy)).toThrowError(PolicyValidationError);
    expect(() => validatePolicy(policy)).toThrowError(/cannot exceed daily limit/);
  });

  it("rejects policy when expiry is in the past", () => {
    const policy: PolicyConfig = {
      agent: sampleAgent,
      agentId: 1n,
      expiresAt: 1000n,
      tokens: [{ token: tokenA, dailyLimit: 10n * 10n ** 18n, perTradeLimit: 5n * 10n ** 18n }],
      targets: [venue],
      selectors: [],
      rates: [],
    };

    expect(() => validatePolicy(policy)).toThrowError(PolicyValidationError);
    expect(() => validatePolicy(policy)).toThrowError(/must be in the future/);
  });

  it("rejects policy when expiry exceeds 30-day cap", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const policy: PolicyConfig = {
      agent: sampleAgent,
      agentId: 1n,
      expiresAt: now + 31n * 86400n,
      tokens: [{ token: tokenA, dailyLimit: 10n * 10n ** 18n, perTradeLimit: 5n * 10n ** 18n }],
      targets: [venue],
      selectors: [],
      rates: [],
    };

    expect(() => validatePolicy(policy, now)).toThrowError(PolicyValidationError);
    expect(() => validatePolicy(policy, now)).toThrowError(/exceeds maximum allowed duration of 30 days/);
  });

  it("rejects policy when selector length is not 4 bytes", () => {
    const policy: PolicyConfig = {
      agent: sampleAgent,
      agentId: 1n,
      expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      tokens: [{ token: tokenA, dailyLimit: 10n * 10n ** 18n, perTradeLimit: 5n * 10n ** 18n }],
      targets: [venue],
      selectors: [{ target: venue, selector: "0x12" as any, allowed: true }],
      rates: [],
    };

    expect(() => validatePolicy(policy)).toThrowError(PolicyValidationError);
    expect(() => validatePolicy(policy)).toThrowError(/Must be 4 bytes/);
  });

  it("builds valid policy using fluent PolicyBuilder", () => {
    const builder = new PolicyBuilder(sampleAgent, 1n, 86400n);
    builder
      .allowToken(tokenA, 50n * 10n ** 18n, 10n * 10n ** 18n)
      .allowTarget(venue)
      .allowSelector(venue, selector, true)
      .setMinRate(tokenA, tokenB, 10n ** 18n);

    const built = builder.build();
    expect(built.agent).toBe(sampleAgent);
    expect(built.tokens.length).toBe(1);
    expect(built.targets.length).toBe(1);
    expect(built.selectors.length).toBe(1);
    expect(built.rates.length).toBe(1);
  });

  // GOLDEN VECTOR TEST: Matches Solidity AgentGuard._hashPolicy EXACTLY
  it("computes policy hash matching onchain Foundry golden vector exactly", () => {
    const goldenPolicy = {
      tokens: [
        {
          token: tokenA as `0x${string}`,
          dailyLimit: 100000000000000000000n, // 100 ether
          perTradeLimit: 20000000000000000000n, // 20 ether
        },
      ],
      targets: [venue as `0x${string}`],
      selectors: [
        {
          target: venue as `0x${string}`,
          selector: selector as `0x${string}`,
          allowed: true,
        },
      ],
      rates: [
        {
          tokenIn: tokenA as `0x${string}`,
          tokenOut: tokenB as `0x${string}`,
          minRate: 1000000000000000000n, // 1 ether
        },
      ],
    };

    const hash = computePolicyHash(goldenPolicy);
    // Expected value comes directly from the contract's own output via Foundry test:
    // contracts/test/GoldenVectors.t.sol::GoldenVectorsTest::test_PrintGoldenVectors()
    // executing: AgentGuard._hashPolicy(policy)
    const expectedOnchainHash = "0xc0486f7c282d0246e0e1b6ad0aa1a88b53f9c7970c914a7dde0fdef97923ed2e";

    expect(hash.toLowerCase()).toBe(expectedOnchainHash.toLowerCase());
  });
});
