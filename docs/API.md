# Aegis-Monad SDK API Reference

Complete API reference for `@aegis-monad/sdk` (v0.1.0).

---

## 1. Core Client: `createAegisClient` & `AegisClient`

```typescript
import { createAegisClient, AegisClient, type AegisClientConfig } from "@aegis-monad/sdk";
```

### `createAegisClient(config: AegisClientConfig): AegisClient`
Factory helper to instantiate an `AegisClient`.

#### Configuration:
- `publicClient: PublicClient` (required): Viem client connected to Monad testnet or local fork.
- `walletClient?: WalletClient` (optional): Viem wallet client with active account for write operations.
- `guardAddress?: Address` (optional): Defaults to deployed `AgentGuard` (`0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618`).
- `registryAddress?: Address` (optional): Defaults to deployed ERC-8004 Registry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`).

---

### Typed Read Methods

#### `getSession(user: Address, agent: Address): Promise<SessionInfo>`
Retrieves delegation status for a user and agent.
- **Returns:** `{ active: boolean, expiresAt: bigint, agentId: bigint }`

#### `getLimit(user: Address, agent: Address, token: Address): Promise<TokenLimitInfo>`
Fetches the limit configuration and current spending window metrics.
- **Returns:** `{ dailyLimit: bigint, perTradeLimit: bigint, spentInWindow: bigint, windowStart: bigint }`

#### `windowRemaining(user: Address, agent: Address, token: Address): Promise<WindowRemainingInfo>`
Calculates remaining budget and seconds until the 24-hour window resets.
- **Returns:** `{ remainingBudget: bigint, secondsUntilReset: bigint }`

#### `balanceOf(user: Address, token: Address): Promise<bigint>`
Reads internal vault balance credited to `user` for `token`.
- **Returns:** Token balance in base units (`bigint`).

#### `passkeyOf(userId: Address): Promise<PasskeyInfo>`
Fetches registered P-256 public key coordinates for a passkey account.
- **Returns:** `{ qx: bigint, qy: bigint }`

#### `nextNonce(userId: Address): Promise<bigint>`
Fetches the current expected replay-protection nonce for a passkey account.
- **Returns:** Current nonce (`bigint`).

#### `isTargetApproved(target: Address): Promise<boolean>`
Checks if a trading venue is on the global allowlist.

#### `getAgentOwner(agentId: bigint): Promise<Address>`
Queries ERC-8004 registry for the owner of `agentId`.

---

### Typed Write Methods (EOA / Mera-Derived Path)

#### `deposit(token: Address, amount: bigint): Promise<Hex>`
Deposits tokens into caller's AgentGuard vault. Automatically checks allowance and issues `approve` if required.
- **Returns:** Transaction hash (`Hex`).

#### `depositFor(user: Address, token: Address, amount: bigint): Promise<Hex>`
Deposits tokens credited to a designated user address (e.g. funding a passkey vault). Handles approval automatically.
- **Returns:** Transaction hash (`Hex`).

#### `withdraw(token: Address, amount: bigint, to: Address): Promise<Hex>`
Withdraws tokens from caller's vault back to recipient address `to`. Always enabled (even when paused).
- **Returns:** Transaction hash (`Hex`).

#### `registerSession(policy: PolicyConfig): Promise<Hex>`
Registers an agent delegation session onchain. Validates constraints before submission.
- **Returns:** Transaction hash (`Hex`).

#### `revokeSession(agent: Address): Promise<Hex>`
Revokes an active session immediately. Always enabled.
- **Returns:** Transaction hash (`Hex`).

---

### Typed Write Methods (WebAuthn Passkey Path)

#### `registerPasskey(qx: bigint, qy: bigint): Promise<{ txHash: Hex, userId: Address }>`
Registers a P-256 public key onchain and derives its deterministic `userId`.
- **Returns:** `{ txHash: Hex, userId: Address }`

#### `registerSessionWithPasskey(params): Promise<Hex>`
Registers a session via a WebAuthn assertion. Can auto-prompt browser passkey signature or accept a pre-signed `auth` object.
- **Parameters:** `{ userId, agent, agentId, expiresAt, policy, nonce?, deadline?, auth?, relayerWalletClient? }`
- **Returns:** Transaction hash (`Hex`).

#### `revokeSessionWithPasskey(params): Promise<Hex>` / `revokeWithPasskey(params): Promise<Hex>`
Revokes an active passkey session via WebAuthn assertion.
- **Parameters:** `{ userId, agent, nonce?, deadline?, auth?, relayerWalletClient? }`
- **Returns:** Transaction hash (`Hex`).

#### `withdrawWithPasskey(params): Promise<Hex>`
Withdraws vault funds to an EOA using a WebAuthn assertion.
- **Parameters:** `{ userId, token, amount, to, nonce?, deadline?, auth?, relayerWalletClient? }`
- **Returns:** Transaction hash (`Hex`).

---

## 2. Policy Builder & Validator

```typescript
import { PolicyBuilder, validatePolicy, computePolicyHash, toOnchainPolicy, type PolicyConfig } from "@aegis-monad/sdk";
```

### `class PolicyBuilder`
Fluent builder enforcing AgentGuard constraints at construction time:
- `.allowToken(token, dailyLimit, perTradeLimit)`: Adds token spending limits.
- `.allowTarget(target)`: Authorizes target venue address.
- `.allowSelector(target, selector, allowed)`: Authorizes 4-byte selector (e.g. `DEPLOYED_ADDRESSES.venueSelectors.swap`).
- `.setMinRate(tokenIn, tokenOut, minRate)`: Sets exchange floor (1e18 scale).
- `.setDuration(seconds)`: Sets duration from now (max 30 days).
- `.setExpiry(timestamp)`: Sets explicit expiration UNIX timestamp.
- `.build(): PolicyConfig`: Validates and returns policy object.

### `validatePolicy(policy: PolicyConfig, currentTimeSeconds?: bigint): void`
Validates policy constraints (e.g., `perTradeLimit <= dailyLimit`, `expiresAt <= 30 days`, valid addresses, 4-byte selectors). Throws `PolicyValidationError` on failure.

### `computePolicyHash(policy): Hex`
Computes the deterministic 32-byte keccak256 hash matching contract's `_hashPolicy(policy)` exactly.

### `computeRegisterSessionPayloadHash(agent, agentId, expiresAt, policyHash): Hex`
Computes the payload hash matching `keccak256(abi.encode(agent, agentId, expiresAt, policyHash))`.

---

## 3. WebAuthn & Passkeys Module

```typescript
import {
  createPasskey,
  signWithPasskey,
  buildChallenge,
  deriveUserId,
  parseDerSignature,
  extractCosePublicKey,
  SECP256R1_N,
  SECP256R1_HALF_N,
  type WebAuthnAuth
} from "@aegis-monad/sdk";
```

### `createPasskey(options?): Promise<PasskeyCreationResult>`
Prompts browser `navigator.credentials.create()`, parses the COSE attestation, and extracts $(q_x, q_y)$ coordinates.
- **Returns:** `{ credentialId, rawId, qx, qy, userId }`

### `signWithPasskey(challenge: Hex, options?): Promise<WebAuthnAuth>`
Prompts browser `navigator.credentials.get()`, parses ASN.1 DER signature, normalizes to low-$s$, and computes `challengeIndex` and `typeIndex`.
- **Returns:** `WebAuthnAuth` struct.

### `buildChallenge(action, user, payloadHash, nonce, deadline, guardAddress?, chainId?): Hex`
Constructs the cryptographic challenge hash matching `AgentGuard`'s `keccak256(abi.encode(...))` exactly.
- Supports actions: `"REGISTER_SESSION" | "REVOKE_SESSION" | "WITHDRAW" | Hex`.

### `deriveUserId(qx: bigint, qy: bigint): Address`
Computes deterministic address: `address(uint160(uint256(keccak256(abi.encode(qx, qy)))))`.

### `parseDerSignature(der: Uint8Array): { r: bigint, s: bigint, isLowS: boolean }`
Extracts $(r, s)$ from ASN.1 DER signature. Automatically normalizes high-$s$ values ($s > N/2$) to $s' = N - s$.

---

## 4. Event Decoders & Watchers

```typescript
import {
  decodePolicyViolation,
  decodeActionExecuted,
  decodePolicyCreated,
  decodeSessionRevoked,
  watchViolations,
  watchExecutions,
  REASON_CODE_NAMES,
  ReasonCode
} from "@aegis-monad/sdk";
```

- `decodePolicyViolation(log)`: Decodes `PolicyViolation` log and translates reason enum to readable strings (e.g. `"EXCEEDS_PER_TRADE"`, `"BAD_PAIR"`, `"TARGET_NOT_ALLOWED"`).
- `decodeActionExecuted(log)`: Decodes `ActionExecuted` with spent, received, and `decisionHash`.
- `watchViolations(publicClient, { guardAddress, onViolation, onError })`: Subscribes to realtime violation events.
- `watchExecutions(publicClient, { guardAddress, onExecution, onError })`: Subscribes to realtime trade execution events.

---

## 5. Mera Helper (`@aegis-monad/sdk/mera`) — `[EXPERIMENTAL / UNTESTED]`

> **WARNING: EXPERIMENTAL / UNTESTED**
> The Mera helper integrates Category Labs' `@category-labs/mera` to derive an EOA via WebAuthn PRF entropy. While covered by unit and mock tests in Vitest, it has **not been tested against real hardware WebAuthn authenticators** on live devices in this environment. For production applications, use standard EOA wallets (MetaMask/Rabby) for Path A or onchain P-256 passkeys (Path B).

```typescript
import { deriveEoaFromPasskey } from "@aegis-monad/sdk/mera";
```

- `deriveEoaFromPasskey(options)`: Derives a viem-compatible EVM account from a hardware passkey PRF extension using `@category-labs/mera` APIs. (EXPERIMENTAL)
