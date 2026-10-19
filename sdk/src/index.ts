/**
 * Aegis-Monad TypeScript SDK
 *
 * Developer-facing SDK for Aegis-Monad: open, non-custodial delegation primitive
 * and policy engine for AI agents on Monad.
 *
 * Supports two distinct user identity paths:
 * - Path A: Traditional EOA or Mera-derived secp256k1 wallet.
 * - Path B: Biometric WebAuthn P-256 passkey verified natively onchain via Monad's 0x0100 precompile.
 *
 * @packageDocumentation
 */

export const VERSION = "0.1.0" as const;

// Contracts, ABIs, and network addresses
export * from "./contracts/index.js";

// Policy construction, validation, and deterministic hashing
export * from "./policy.js";

// WebAuthn Passkey operations, DER parsing, and challenge building
export * from "./passkey.js";

// Event decoders, ReasonCode mappings, and onchain watchers
export * from "./events.js";

// Main high-level Aegis client
export * from "./client.js";
