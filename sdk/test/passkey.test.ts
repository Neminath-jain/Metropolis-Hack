import { describe, it, expect } from "vitest";
import {
  SECP256R1_N,
  SECP256R1_HALF_N,
  buildChallenge,
  deriveUserId,
  parseDerSignature,
  REGISTER_SESSION_TYPEHASH,
  REVOKE_SESSION_TYPEHASH,
  WITHDRAW_TYPEHASH,
  computeRevokeSessionPayloadHash,
  computeWithdrawPayloadHash,
} from "../src/passkey.js";
import { createSoftwarePasskey } from "../src/softwareAuthenticator.js";

describe("Passkey & WebAuthn Module", () => {
  it("derives N >> 1 correctly in code to prevent malleability", () => {
    expect(SECP256R1_HALF_N).toBe(SECP256R1_N >> 1n);
    expect(SECP256R1_HALF_N * 2n).toBeLessThan(SECP256R1_N);
    expect((SECP256R1_HALF_N + 1n) * 2n).toBeGreaterThan(SECP256R1_N);
  });

  it("normalizes malleable high-s signature to low-s in parseDerSignature", () => {
    // Construct dummy DER with low-r and high-s
    const rBig = 12345678901234567890n;
    const highSBig = SECP256R1_N - 42n; // Clearly > N/2

    const rHex = rBig.toString(16).padStart(64, "0");
    const highSHex = highSBig.toString(16).padStart(64, "0");

    const rBuf = Buffer.from(rHex, "hex");
    const sBuf = Buffer.from(highSHex, "hex");

    // DER encoding: 0x30 [len] 0x02 [r_len] [r] 0x02 [s_len] [s]
    const seq = Buffer.concat([
      Buffer.from([0x02, rBuf.length]),
      rBuf,
      Buffer.from([0x02, sBuf.length]),
      sBuf,
    ]);
    const der = Buffer.concat([Buffer.from([0x30, seq.length]), seq]);

    const parsed = parseDerSignature(new Uint8Array(der));
    expect(parsed.r).toBe(rBig);
    expect(parsed.isLowS).toBe(false);
    expect(parsed.s).toBe(42n); // Normalized to N - highS = 42n <= N/2
    expect(parsed.s).toBeLessThanOrEqual(SECP256R1_HALF_N);
  });

  // GOLDEN VECTOR TEST 1: RegisterSession challenge matches Solidity AgentGuard exactly
  it("builds RegisterSession challenge hash matching Foundry contract golden vector exactly", () => {
    const chainId = 10143n;
    const guard = "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618";
    const user = "0x8ec3b943e88E33E31920E73F729d642b03A6A3f3";
    const payloadHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const nonce = 0n;
    const deadline = 1700000000n;

    const challenge = buildChallenge(
      REGISTER_SESSION_TYPEHASH,
      chainId,
      guard,
      user,
      payloadHash,
      nonce,
      deadline
    );

    // Expected value comes from the contract's own output via Foundry test:
    // contracts/test/GoldenVectors.t.sol::GoldenVectorsTest::test_PrintGoldenVectors()
    const expectedFoundryChallenge = "0xd6d110e62d32a169b07063510d59bb2a3d6d3054c0eae51bc5bb733edba9000c";

    expect(challenge.toLowerCase()).toBe(expectedFoundryChallenge.toLowerCase());
  });

  // GOLDEN VECTOR TEST 2: RevokeSession challenge matches Solidity AgentGuard exactly
  it("builds RevokeSession challenge hash matching Foundry contract golden vector exactly", () => {
    const chainId = 10143n;
    const guard = "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618";
    const user = "0x8ec3b943e88E33E31920E73F729d642b03A6A3f3";
    const agent = "0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd";
    const payloadHash = computeRevokeSessionPayloadHash(agent);
    const nonce = 1n;
    const deadline = 1700000000n;

    const challenge = buildChallenge(
      REVOKE_SESSION_TYPEHASH,
      chainId,
      guard,
      user,
      payloadHash,
      nonce,
      deadline
    );

    // Expected value comes from the contract's own output via Foundry test:
    // contracts/test/GoldenVectors.t.sol::GoldenVectorsTest::test_PrintGoldenVectors()
    const expectedFoundryRevokeChallenge = "0x85d446b072753ef00baa25d1c450de60b9aac2b515e83c3d9a9ca0d056214dbb";

    expect(challenge.toLowerCase()).toBe(expectedFoundryRevokeChallenge.toLowerCase());
  });

  // GOLDEN VECTOR TEST 3: Withdraw challenge matches Solidity AgentGuard exactly
  it("builds Withdraw challenge hash matching Foundry contract golden vector exactly", () => {
    const chainId = 10143n;
    const guard = "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618";
    const user = "0x8ec3b943e88E33E31920E73F729d642b03A6A3f3";
    const token = "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9";
    const amount = 5000000000000000000n; // 5 ether
    const withdrawTo = "0x2222222222222222222222222222222222222222";
    const payloadHash = computeWithdrawPayloadHash(token, amount, withdrawTo);
    const nonce = 2n;
    const deadline = 1700000000n;

    const challenge = buildChallenge(
      WITHDRAW_TYPEHASH,
      chainId,
      guard,
      user,
      payloadHash,
      nonce,
      deadline
    );

    // Expected value comes from the contract's own output via Foundry test:
    // contracts/test/GoldenVectors.t.sol::GoldenVectorsTest::test_PrintGoldenVectors()
    const expectedFoundryWithdrawChallenge = "0xaba8e3b8a56261be148422ab4a26d4d5e79ebc0d39fb35e338af1111c77b8134";

    expect(challenge.toLowerCase()).toBe(expectedFoundryWithdrawChallenge.toLowerCase());
  });

  it("derives deterministic userId from P256 coordinates", () => {
    const qx = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296n;
    const qy = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5n;

    const userId = deriveUserId(qx, qy);
    expect(userId).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // Calling deriveUserId again with same coordinates returns identical address
    const userId2 = deriveUserId(qx, qy);
    expect(userId).toBe(userId2);
  });

  it("creates valid assertion using SoftwarePasskey authenticator", () => {
    const passkey = createSoftwarePasskey();
    expect(passkey.qx).toBeGreaterThan(0n);
    expect(passkey.qy).toBeGreaterThan(0n);
    expect(passkey.userId).toMatch(/^0x[a-fA-F0-9]{40}$/);

    const payloadHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const auth = passkey.signAssertion(
      REGISTER_SESSION_TYPEHASH,
      10143n,
      "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618",
      payloadHash,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 3600)
    );

    expect(auth.authenticatorData).toMatch(/^0x/);
    expect(auth.clientDataJSON).toContain("webauthn.get");
    expect(auth.challengeIndex).toBe(23n);
    expect(auth.typeIndex).toBe(1n);

    // Verify low-s enforcement
    const sBig = BigInt(auth.s);
    expect(sBig).toBeLessThanOrEqual(SECP256R1_HALF_N);
  });

  it("supports forceHighS flag in SoftwarePasskey for negative malleability testing", () => {
    const passkey = createSoftwarePasskey();
    const payloadHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const highSAuth = passkey.signAssertion(
      REGISTER_SESSION_TYPEHASH,
      10143n,
      "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618",
      payloadHash,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 3600),
      { forceHighS: true }
    );

    const sBig = BigInt(highSAuth.s);
    expect(sBig).toBeGreaterThan(SECP256R1_HALF_N);
  });
});
