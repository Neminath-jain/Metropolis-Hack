/**
 * Aegis-Monad Software Authenticator
 * Node.js-compatible WebAuthn software authenticator for testing and programmatic passkey flows.
 * Generates secp256r1 (P256) keypairs and signs real WebAuthn assertions matching AgentGuard.sol.
 */

import { generateKeyPairSync, createSign, createHash } from "crypto";
import {
  type Address,
  type Hex,
  toHex,
} from "viem";
import {
  SECP256R1_N,
  parseDerSignature,
  type WebAuthnAuth,
  buildChallenge,
  deriveUserId,
} from "./passkey.js";

export interface SoftwarePasskeyAccount {
  readonly qx: bigint;
  readonly qy: bigint;
  readonly userId: Address;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  signAssertion(
    actionTypehash: Hex,
    chainId: bigint,
    guardAddress: Address,
    payloadHash: Hex,
    nonce: bigint,
    deadline: bigint,
    options?: { forceHighS?: boolean; origin?: string }
  ): WebAuthnAuth;
}

/**
 * Creates an in-memory software P256 passkey authenticator.
 * Produces real cryptographic signatures verifiable by Monad's 0x0100 precompile.
 */
export function createSoftwarePasskey(): SoftwarePasskeyAccount {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1", // ANSI X9.62 / NIST P-256
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Extract raw uncompressed point (65 bytes: 0x04 || X (32 bytes) || Y (32 bytes)) from SPKI DER
  // SPKI header for prime256v1 is 26 bytes, followed by 0x04 and coordinates
  const derBuffer = Buffer.from(publicKey);
  const uncompressedKey = derBuffer.subarray(derBuffer.length - 65);
  if (uncompressedKey[0] !== 0x04) {
    throw new Error("Invalid uncompressed P256 public key header");
  }

  const qxBytes = uncompressedKey.subarray(1, 33);
  const qyBytes = uncompressedKey.subarray(33, 65);
  const qx = BigInt("0x" + qxBytes.toString("hex"));
  const qy = BigInt("0x" + qyBytes.toString("hex"));
  const userId = deriveUserId(qx, qy);

  const signAssertion = (
    actionTypehash: Hex,
    chainId: bigint,
    guardAddress: Address,
    payloadHash: Hex,
    nonce: bigint,
    deadline: bigint,
    options?: { forceHighS?: boolean; origin?: string }
  ): WebAuthnAuth => {
    const origin = options?.origin ?? "http://localhost:3000";

    // 1. Build expected challenge hash
    const challenge = buildChallenge(
      actionTypehash,
      chainId,
      guardAddress,
      userId,
      payloadHash,
      nonce,
      deadline
    );

    // 2. Base64url-encode challenge without '=' padding
    const challengeBuffer = Buffer.from(challenge.replace(/^0x/, ""), "hex");
    const encodedChallenge = challengeBuffer.toString("base64url");

    // 3. Construct clientDataJSON
    // Index 0: '{'
    // Index 1: '"type":"webauthn.get"'
    // Index 22: ','
    // Index 23: '"challenge":"...'
    const clientDataJSON = `{"type":"webauthn.get","challenge":"${encodedChallenge}","origin":"${origin}"}`;
    const clientDataHash = createHash("sha256").update(clientDataJSON, "utf8").digest();

    // 4. AuthenticatorData: 37 bytes (32B rpIdHash + 1B flags (UP|UV = 0x05) + 4B counter)
    const rpIdHash = createHash("sha256").update(new URL(origin).hostname || "localhost").digest();
    const flags = Buffer.from([0x05]); // UP (bit 0) | UV (bit 2)
    const signCount = Buffer.from([0, 0, 0, 1]);
    const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);

    // 5. Message to sign: authenticatorData || sha256(clientDataJSON)
    const msgToSign = Buffer.concat([authenticatorData, clientDataHash]);

    // 6. Sign message using ECDSA-SHA256
    const signer = createSign("SHA256");
    signer.update(msgToSign);
    const derSignature = signer.sign(privateKey);

    // 7. Parse ASN.1 DER signature and normalize to low-s
    const { r, s } = parseDerSignature(new Uint8Array(derSignature));

    const finalS = options?.forceHighS ? SECP256R1_N - s : s;

    return {
      authenticatorData: toHex(authenticatorData),
      clientDataJSON,
      challengeIndex: 23n,
      typeIndex: 1n,
      r: toHex(r, { size: 32 }),
      s: toHex(finalS, { size: 32 }),
    };
  };

  return {
    qx,
    qy,
    userId,
    privateKeyPem: privateKey,
    publicKeyPem: Buffer.from(publicKey).toString("base64"),
    signAssertion,
  };
}
