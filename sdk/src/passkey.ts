/**
 * Aegis-Monad Passkey & WebAuthn Module
 * Browser and Node-compatible utilities for creating P256 passkeys, signing WebAuthn assertions,
 * DER-to-low-s normalization, challenge construction, and relayer submission.
 */

import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  slice,
  toHex,
  stringToHex,
} from "viem";
import { DEPLOYED_ADDRESSES } from "./contracts/generated.js";

/** SECP256R1 curve order N */
export const SECP256R1_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;

/**
 * Derived half-order N >> 1 (enforcing low-s non-malleability).
 * Computed dynamically in code, never hardcoded.
 */
export const SECP256R1_HALF_N = SECP256R1_N >> 1n;

/** Typehash for passkey-authorized session registration */
export const REGISTER_SESSION_TYPEHASH: Hex = keccak256(
  stringToHex(
    "RegisterSessionWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
  )
);

/** Typehash for passkey-authorized session revocation */
export const REVOKE_SESSION_TYPEHASH: Hex = keccak256(
  stringToHex(
    "RevokeSessionWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
  )
);

/** Typehash for passkey-authorized token withdrawal */
export const WITHDRAW_TYPEHASH: Hex = keccak256(
  stringToHex(
    "WithdrawWithPasskey(uint256 chainId,address guard,address userId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
  )
);

/** Action name or custom typehash for passkey authorization */
export type PasskeyAction = "REGISTER_SESSION" | "REVOKE_SESSION" | "WITHDRAW" | Hex;

/** Resolves action name to its corresponding 32-byte typehash */
export function getActionTypehash(action: PasskeyAction): Hex {
  if (action === "REGISTER_SESSION") return REGISTER_SESSION_TYPEHASH;
  if (action === "REVOKE_SESSION") return REVOKE_SESSION_TYPEHASH;
  if (action === "WITHDRAW") return WITHDRAW_TYPEHASH;
  return action;
}

/** WebAuthnAuth struct required by AgentGuard.sol */
export interface WebAuthnAuth {
  readonly authenticatorData: Hex;
  readonly clientDataJSON: string;
  readonly challengeIndex: bigint;
  readonly typeIndex: bigint;
  readonly r: Hex;
  readonly s: Hex;
}

/**
 * Computes payload hash for session registration matching AgentGuard.sol:
 * keccak256(abi.encode(agent, agentId, expiresAt, policyHash))
 */
export function computeRegisterSessionPayloadHash(
  agent: Address,
  agentId: bigint,
  expiresAt: bigint,
  policyHash: Hex
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }],
      [agent, agentId, expiresAt, policyHash]
    )
  );
}

/**
 * Computes payload hash for session revocation matching AgentGuard.sol:
 * keccak256(abi.encode(agent))
 */
export function computeRevokeSessionPayloadHash(agent: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }], [agent]));
}

/**
 * Computes payload hash for token withdrawal matching AgentGuard.sol:
 * keccak256(abi.encode(token, amount, to))
 */
export function computeWithdrawPayloadHash(
  token: Address,
  amount: bigint,
  to: Address
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }],
      [token, amount, to]
    )
  );
}

/** Result of creating a browser passkey */
export interface PasskeyCreationResult {
  readonly credentialId: string;
  readonly rawId: Hex;
  readonly qx: bigint;
  readonly qy: bigint;
  readonly userId: Address;
}

/**
 * Derives the deterministic passkey userId matching AgentGuard.sol:
 * address(uint160(uint256(keccak256(abi.encode(qx, qy)))))
 */
export function deriveUserId(qx: bigint, qy: bigint): Address {
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [qx, qy]
  );
  const hash = keccak256(encoded);
  return getAddress(slice(hash, 12));
}

/**
 * Parses an ASN.1 DER-encoded ECDSA signature and converts it to normalized low-s coordinates (r, s).
 * Replaces high-s signatures with s' = N - s when s > N/2 to prevent signature malleability.
 *
 * @param der - ASN.1 DER signature bytes
 * @returns { r: bigint, s: bigint, isLowS: boolean }
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint; isLowS: boolean } {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error("Invalid ASN.1 DER signature header (expected sequence tag 0x30)");
  }

  let offset = 2;
  // Handle multi-byte sequence length if needed
  if (der[1] & 0x80) {
    const lenBytes = der[1] & 0x7f;
    offset = 2 + lenBytes;
  }

  // Parse r
  if (der[offset] !== 0x02) {
    throw new Error("Invalid DER sequence: expected INTEGER tag 0x02 for r");
  }
  const rLen = der[offset + 1];
  offset += 2;
  const rBytes = der.subarray(offset, offset + rLen);
  offset += rLen;

  // Parse s
  if (der[offset] !== 0x02) {
    throw new Error("Invalid DER sequence: expected INTEGER tag 0x02 for s");
  }
  const sLen = der[offset + 1];
  offset += 2;
  const sBytes = der.subarray(offset, offset + sLen);

  // Convert to BigInt (stripping any leading sign zero byte)
  const rHex = Array.from(rBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const sHex = Array.from(sBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const r = BigInt("0x" + (rHex || "0"));
  const rawS = BigInt("0x" + (sHex || "0"));

  // Check and normalize to low-s (s <= N/2)
  const isLowS = rawS <= SECP256R1_HALF_N;
  const s = isLowS ? rawS : SECP256R1_N - rawS;

  return { r, s, isLowS };
}

/**
 * Constructs the cryptographic challenge hash matching AgentGuard.sol:
 * keccak256(abi.encode(actionTypehash, chainId, guard, userId, payloadHash, nonce, deadline))
 */
export function buildChallenge(
  action: PasskeyAction,
  user: Address,
  payloadHash: Hex,
  nonce: bigint,
  deadline: bigint,
  guardAddress?: Address,
  chainId?: bigint
): Hex;
export function buildChallenge(
  actionTypehash: Hex,
  chainId: bigint,
  guardAddress: Address,
  userId: Address,
  payloadHash: Hex,
  nonce: bigint,
  deadline: bigint
): Hex;
export function buildChallenge(
  arg1: PasskeyAction | Hex,
  arg2: Address | bigint,
  arg3: Hex | Address,
  arg4?: Address | bigint,
  arg5?: Hex | bigint,
  arg6?: bigint | Address,
  arg7?: bigint
): Hex {
  if (typeof arg2 === "bigint") {
    // 7-argument signature: (actionTypehash, chainId, guardAddress, userId, payloadHash, nonce, deadline)
    const actionTypehash = arg1 as Hex;
    const chainId = arg2;
    const guardAddress = arg3 as Address;
    const userId = arg4 as Address;
    const payloadHash = arg5 as Hex;
    const nonce = arg6 as bigint;
    const deadline = arg7 as bigint;

    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [actionTypehash, chainId, guardAddress, userId, payloadHash, nonce, deadline]
      )
    );
  }

  // 5-to-7 argument developer-friendly signature: (action, user, payloadHash, nonce, deadline, guardAddress?, chainId?)
  const typehash = getActionTypehash(arg1 as PasskeyAction);
  const user = arg2 as Address;
  const payloadHash = arg3 as Hex;
  const nonce = arg4 as bigint;
  const deadline = arg5 as bigint;
  const guardAddress = (typeof arg6 === "string" ? arg6 : undefined) ?? DEPLOYED_ADDRESSES.agentGuard;
  const chainId = (typeof arg7 === "bigint" ? arg7 : undefined) ?? BigInt(DEPLOYED_ADDRESSES.chainId);

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [typehash, chainId, guardAddress, user, payloadHash, nonce, deadline]
    )
  );
}

/**
 * Extracts public key coordinates (qx, qy) from WebAuthn attestation buffer containing COSE key.
 */
export function extractCosePublicKey(attestationBuffer: ArrayBuffer): { qx: bigint; qy: bigint } {
  const bytes = new Uint8Array(attestationBuffer);

  // Minimal scanning for COSE Key EC2 map containing x (-2) and y (-3) 32-byte coordinates
  // Tag 0x58 0x20 represents byte string of length 32 in CBOR
  let qx: bigint | undefined;
  let qy: bigint | undefined;

  for (let i = 0; i < bytes.length - 35; i++) {
    // Look for CBOR negative key -2 (0x21) followed by 32-byte byte string (0x58 0x20)
    if (bytes[i] === 0x21 && bytes[i + 1] === 0x58 && bytes[i + 2] === 0x20) {
      const xBytes = bytes.subarray(i + 3, i + 35);
      qx = BigInt("0x" + Array.from(xBytes).map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    // Look for CBOR negative key -3 (0x22) followed by 32-byte byte string (0x58 0x20)
    if (bytes[i] === 0x22 && bytes[i + 1] === 0x58 && bytes[i + 2] === 0x20) {
      const yBytes = bytes.subarray(i + 3, i + 35);
      qy = BigInt("0x" + Array.from(yBytes).map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
  }

  if (qx === undefined || qy === undefined) {
    throw new Error(
      "Failed to extract (qx, qy) coordinates from WebAuthn attestation object. Ensure authenticator supports ES256 / secp256r1."
    );
  }

  return { qx, qy };
}

/**
 * Creates a new WebAuthn passkey in the browser environment.
 * Extracts P256 public key coordinates (qx, qy) and derives the deterministic onchain userId.
 *
 * @param options - WebAuthn registration parameters
 */
export async function createPasskey(options?: {
  userName?: string;
  userDisplayName?: string;
  rpName?: string;
  rpId?: string;
}): Promise<PasskeyCreationResult> {
  if (typeof window === "undefined" || !navigator?.credentials?.create) {
    throw new Error("createPasskey() requires a browser environment supporting WebAuthn API");
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const userIdBuffer = new Uint8Array(16);
  crypto.getRandomValues(userIdBuffer);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: options?.rpName ?? "Aegis-Monad",
        id: options?.rpId ?? window.location.hostname,
      },
      user: {
        id: userIdBuffer,
        name: options?.userName ?? "aegis-user@monad",
        displayName: options?.userDisplayName ?? "Aegis User",
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ES256 (secp256r1)
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential & { response: AuthenticatorAttestationResponse };

  if (!credential || !credential.response) {
    throw new Error("WebAuthn credentials.create returned null or empty response");
  }

  const { qx, qy } = extractCosePublicKey(credential.response.attestationObject);
  const userId = deriveUserId(qx, qy);

  return {
    credentialId: credential.id,
    rawId: toHex(new Uint8Array(credential.rawId)),
    qx,
    qy,
    userId,
  };
}

/**
 * Signs a WebAuthn assertion in the browser for a given challenge hash.
 * Formats the response into the exact WebAuthnAuth struct required by AgentGuard.
 *
 * @param challenge - 32-byte hexadecimal challenge hash
 */
export async function signWithPasskey(challenge: Hex): Promise<WebAuthnAuth> {
  if (typeof window === "undefined" || !navigator?.credentials?.get) {
    throw new Error("signWithPasskey() requires a browser environment supporting WebAuthn API");
  }

  const challengeBytes = new Uint8Array(
    challenge.replace(/^0x/, "").match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes,
      userVerification: "required",
      timeout: 60000,
    },
  })) as PublicKeyCredential & { response: AuthenticatorAssertionResponse };

  if (!assertion || !assertion.response) {
    throw new Error("WebAuthn credentials.get returned null or empty response");
  }

  const authenticatorDataBytes = new Uint8Array(assertion.response.authenticatorData);
  const clientDataJSONString = new TextDecoder("utf-8").decode(assertion.response.clientDataJSON);

  // Parse DER signature and normalize to low-s
  const { r, s } = parseDerSignature(new Uint8Array(assertion.response.signature));

  // Determine challengeIndex and typeIndex in clientDataJSON
  const challengeIndex = BigInt(clientDataJSONString.indexOf('"challenge":"'));
  const typeIndex = BigInt(clientDataJSONString.indexOf('"type":"webauthn.get"'));

  if (challengeIndex < 0n || typeIndex < 0n) {
    throw new Error("Failed to locate challenge or type indices in clientDataJSON");
  }

  return {
    authenticatorData: toHex(authenticatorDataBytes),
    clientDataJSON: clientDataJSONString,
    challengeIndex,
    typeIndex,
    r: toHex(r, { size: 32 }),
    s: toHex(s, { size: 32 }),
  };
}
