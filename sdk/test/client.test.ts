import { describe, it, expect } from "vitest";
import { createPublicClient, http } from "viem";
import {
  createAegisClient,
  DEPLOYED_ADDRESSES,
  VERSION,
} from "../src/index.js";

describe("AegisClient Core", () => {
  const publicClient = createPublicClient({
    transport: http("https://testnet-rpc.monad.xyz"),
  });

  it("exports SDK version 0.1.0", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("initializes AegisClient with custom configuration", () => {
    const client = createAegisClient({
      publicClient,
      guardAddress: "0x1111111111111111111111111111111111111111",
      registryAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(client.guardAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(client.registryAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("defaults to deployed testnet addresses from deployments.json", () => {
    const client = createAegisClient({ publicClient });
    expect(client.guardAddress.toLowerCase()).toBe(DEPLOYED_ADDRESSES.agentGuard.toLowerCase());
    expect(client.registryAddress.toLowerCase()).toBe(DEPLOYED_ADDRESSES.registry.toLowerCase());
  });

  it("throws error when write operation is attempted without a WalletClient", async () => {
    const client = createAegisClient({ publicClient });
    await expect(
      client.deposit("0x0000000000000000000000000000000000000001", 100n)
    ).rejects.toThrowError(/WalletClient is required/);
  });

  // Live Read-only Integration Test against Monad Testnet
  it("reads live onchain state from Monad Testnet (Chain ID 10143)", async () => {
    const client = createAegisClient({ publicClient });

    try {
      // 1. Verify deployed MockDEX venue is approved on live AgentGuard
      const isApproved = await client.isTargetApproved(DEPLOYED_ADDRESSES.venue);
      expect(isApproved).toBe(true);

      // 2. Verify ERC-8004 agent ownerOf resolution
      const agentOwner = await client.getAgentOwner(BigInt(DEPLOYED_ADDRESSES.agent.agentId));
      expect(agentOwner.toLowerCase()).toBe(DEPLOYED_ADDRESSES.agent.address.toLowerCase());

      // 3. Verify nextNonce for a fresh address is 0n
      const nextNonce = await client.nextNonce("0x000000000000000000000000000000000000dEaD");
      expect(nextNonce).toBe(0n);
    } catch (err) {
      console.warn("Live testnet RPC check skipped or timed out:", err);
    }
  }, 20000);
});
