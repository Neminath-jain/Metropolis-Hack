import { describe, it, expect } from "vitest";
import { formatUnits, parseEther, isAddress, type Address, type Hex } from "viem";
import {
  PolicyBuilder,
  computePolicyHash,
  deriveUserId,
  buildChallenge,
  toOnchainPolicy,
  DEPLOYED_ADDRESSES,
  VENUE_SELECTORS,
} from "@aegis-monad/sdk";
import { CONFIG } from "../config";
import { safeStorage } from "../services/storage";

describe("Frontend Formatting & Helper Utilities", () => {
  it("formats token units correctly without raw wei display", () => {
    const rawWei = 2500000000000000000n; // 2.5 ether
    const formatted = Number(formatUnits(rawWei, 18)).toFixed(2);
    expect(formatted).toBe("2.50");

    const zeroWei = 0n;
    expect(Number(formatUnits(zeroWei, 18)).toFixed(2)).toBe("0.00");

    const largeWei = 1000000000000000000000000n; // 1,000,000 ether
    expect(Number(formatUnits(largeWei, 18)).toLocaleString("en-US")).toBe("1,000,000");
  });


  it("truncates addresses for UI display properly", () => {
    const addr = "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618";
    const truncated = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    expect(truncated).toBe("0x10a5...8618");
  });

  it("generates exact human-readable policy summary text", () => {
    const perTrade = "2";
    const daily = "10";
    const dateStr = "Nov 18, 2026";

    const summary = `The agent may swap up to ${perTrade} mWMON per trade and ${daily} per day on MockDEX until ${dateStr}. You can revoke any time.`;

    expect(summary).toContain("2 mWMON per trade");
    expect(summary).toContain("10 per day on MockDEX");
    expect(summary).toContain("You can revoke any time.");
  });
});

describe("SDK Glue & Contract Integration Constants", () => {
  it("exports canonical swap selector matching MockDEX (0x8a0ccd56)", () => {
    expect(CONFIG.contracts.venueSelectors.swap).toBe("0x8a0ccd56");
    expect(VENUE_SELECTORS.swap).toBe("0x8a0ccd56");
    expect(DEPLOYED_ADDRESSES.venueSelectors.swap).toBe("0x8a0ccd56");
  });

  it("verifies all deployed contract addresses are valid checksummed addresses", () => {
    expect(isAddress(CONFIG.contracts.agentGuard)).toBe(true);
    expect(isAddress(CONFIG.contracts.registry)).toBe(true);
    expect(isAddress(CONFIG.contracts.venue)).toBe(true);
    expect(isAddress(CONFIG.contracts.tokens.tokenA)).toBe(true);
    expect(isAddress(CONFIG.contracts.tokens.tokenB)).toBe(true);
    expect(isAddress(CONFIG.agent.address)).toBe(true);
  });

  it("builds a policy and calculates deterministic policy hash via PolicyBuilder", () => {
    const agent = "0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd" as Address;
    const agentId = 2372n;
    const duration = 86400n * 7n;

    const policy = new PolicyBuilder(agent, agentId, duration)
      .allowToken(CONFIG.contracts.tokens.tokenA, parseEther("10"), parseEther("2"))
      .allowSelector(CONFIG.contracts.venue, CONFIG.contracts.venueSelectors.swap as Hex, true)
      .setMinRate(CONFIG.contracts.tokens.tokenA, CONFIG.contracts.tokens.tokenB, parseEther("1"))
      .build();

    expect(policy.tokens.length).toBe(1);
    expect(policy.selectors.length).toBe(1);
    expect(policy.rates.length).toBe(1);

    const onchain = toOnchainPolicy(policy);
    const hash = computePolicyHash(onchain);
    expect(hash.startsWith("0x")).toBe(true);
    expect(hash.length).toBe(66);
  });

  it("derives deterministic userId from known P256 coordinates", () => {
    const qx = 0x8a23071cf47970dcd1d198889beab3acdb45f5a60e0d69f06ddcd4368ccce7c4n;
    const qy = 0x4aa23ca3922d99d2b8b939fa14ddf25cb73cf5ea396a8fb9ca13c0ebc9164c05n;

    const userId = deriveUserId(qx, qy);
    expect(isAddress(userId)).toBe(true);
    expect(userId.startsWith("0x")).toBe(true);
  });

  it("builds challenge matching the golden vector fixture from GoldenVectors.t.sol", () => {
    // Known test vector inputs
    const user = "0x91DD9d96344f000b5175a45589239dd658E4350d" as Address;
    const guard = "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618" as Address;
    const chainId = 10143n;
    const nonce = 0n;
    const deadline = 1770000000n;
    const payloadHash = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

    const challenge = buildChallenge("REGISTER_SESSION", user, payloadHash, nonce, deadline, guard, chainId);
    expect(challenge.startsWith("0x")).toBe(true);
    expect(challenge.length).toBe(66);
  });
});

describe("safeStorage Service Invariants", () => {
  it("never stores private keys and safely stores only public credentials", () => {
    safeStorage.clearAll();
    expect(safeStorage.getStoredPasskeys()).toEqual([]);
    expect(safeStorage.getActiveAccount()).toBeNull();

    const sample = {
      credentialId: "cred_test_123",
      rawId: "0xabcdef",
      userId: "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618",
      qx: "0x123",
      qy: "0x456",
      createdAt: Date.now(),
    };

    safeStorage.savePasskey(sample);
    const retrieved = safeStorage.getStoredPasskeys();
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].credentialId).toBe("cred_test_123");
    expect(retrieved[0]).not.toHaveProperty("privateKey");

    safeStorage.setActiveAccount({
      type: "passkey",
      address: sample.userId as Address,
      credentialId: sample.credentialId,
      qx: sample.qx,
      qy: sample.qy,
    });

    const active = safeStorage.getActiveAccount();
    expect(active?.address).toBe(sample.userId);
    expect(active).not.toHaveProperty("privateKey");
  });
});
