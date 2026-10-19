# @aegis-monad/sdk

**Bounded, Revocable AI Agent Delegation for Monad**

`@aegis-monad/sdk` is the developer-facing TypeScript SDK for **Aegis-Monad**—a non-custodial smart vault primitive and policy engine live on Monad Testnet (Chain ID `10143`).

It empowers any Web3 application to grant an AI trading agent bounded, revocable authority over user funds in **~10 lines of code**, supporting two identity paths:
- **Path A: EOA or Mera-derived Wallet** (standard EVM signatures).
- **Path B: Hardware Passkeys (WebAuthn P-256)** verified natively onchain via Monad's RIP-7212 `0x0100` precompile.

---

## Installation

```bash
npm install @aegis-monad/sdk viem
```

> **Note:** `viem` (>= 2.20.0) is a required peer dependency.

---

## 10-Line Quickstart

### Path A: EOA / Mera-Derived Wallet

```typescript
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAegisClient, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";

const publicClient = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const walletClient = createWalletClient({ account: privateKeyToAccount(USER_KEY), transport: http("https://testnet-rpc.monad.xyz") });
const aegis = createAegisClient({ publicClient, walletClient });

// 1. Deposit into vault
await aegis.deposit(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("5"));

// 2. Configure & register agent delegation policy (10 lines total integration)
const policy = new PolicyBuilder(DEPLOYED_ADDRESSES.agent.address, BigInt(DEPLOYED_ADDRESSES.agent.agentId), 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
  .build();

await aegis.registerSession(policy);
const session = await aegis.getSession(walletClient.account.address, DEPLOYED_ADDRESSES.agent.address);
console.log("Session active:", session.active); // true
```

### Path B: WebAuthn Passkeys (Hardware P-256)

```typescript
import { createPublicClient, http, parseEther } from "viem";
import { createAegisClient, createPasskey, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";

const publicClient = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const aegis = createAegisClient({ publicClient });

// 1. Create biometric passkey & derive onchain userId
const { qx, qy, userId } = await createPasskey({ rpName: "My DeFi App" });
await relayer.registerPasskey(qx, qy);

// 2. Delegate with passkey assertion (gasless via relayer)
const policy = new PolicyBuilder(DEPLOYED_ADDRESSES.agent.address, BigInt(DEPLOYED_ADDRESSES.agent.agentId), 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
  .build();

await aegis.registerSessionWithPasskey({ userId, agent: policy.agent, agentId: policy.agentId, expiresAt: policy.expiresAt, policy, relayerWalletClient });
```

---

## Package Exports Map

- `.` : Core SDK client, policy builder, passkey helpers, event decoders, contract ABIs, testnet addresses.
- `./mera` : Mera Passkey-derived EOA derivation helper (`deriveEoaFromPasskey()`) — `[EXPERIMENTAL / UNTESTED]` (mock/unit tested in CI, hardware PRF unverified in this environment).
- `./testing` : `SoftwarePasskeyAccount` and `createSoftwarePasskey()` for Node.js scripts, Anvil forks, and CI pipelines.

---

## Bundle Sizes

Compiled with `tsup` targeting `es2022`:
- **ESM (`dist/index.js`):** ~71.9 KB (minified + gzipped: ~19 KB)
- **CJS (`dist/index.cjs`):** ~73.0 KB
- **Mera Helper (`dist/mera.js`):** ~1.2 KB
- **Software Authenticator (`dist/softwareAuthenticator.js`):** ~6.4 KB

Zero browser polyfill dependencies; fully tree-shakeable.
