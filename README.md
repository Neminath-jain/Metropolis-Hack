# Aegis-Monad

**An open, non-custodial delegation primitive and policy engine for AI agents on Monad.** Aegis-Monad gives autonomous AI agents bounded, revocable authority over user funds in about 10 lines of code, verified natively onchain via Monad's RIP-7212 P-256 precompile (`0x0100`) and ERC-8004 identity provenance.

---

## 10-Line Quickstart

Delegate bounded authority to an AI trading agent in ~10 lines of TypeScript:

```typescript
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAegisClient, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";

const publicClient = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const walletClient = createWalletClient({ account: privateKeyToAccount(USER_PRIVATE_KEY), transport: http("https://testnet-rpc.monad.xyz") });
const aegis = createAegisClient({ publicClient, walletClient });

// 1. Deposit into vault
await aegis.deposit(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("5.0"));

// 2. Configure policy with 24h & per-trade spending limits
const policy = new PolicyBuilder(DEPLOYED_ADDRESSES.agent.address, BigInt(DEPLOYED_ADDRESSES.agent.agentId), 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
  .build();

// 3. Register session & verify onchain
await aegis.registerSession(policy);
const session = await aegis.getSession(walletClient.account.address, DEPLOYED_ADDRESSES.agent.address);
console.log("Session Active:", session.active); // true
```

---

## Live Deployments (Monad Testnet - Chain ID 10143)

All contracts are deployed and verified on Monad Testnet:

| Contract | Address | Explorer / Verification Link |
| :--- | :--- | :--- |
| **AgentGuard** | [`0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618`](https://testnet.monadscan.com/address/0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618#code) | [MonadScan Verified Contract](https://testnet.monadscan.com/address/0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618#code) |
| **ERC-8004 Registry** | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.monadscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | [Official Canonical Testnet Registry](https://testnet.monadscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| **MockDEX Venue** | [`0xF9d1265d4f87B993244008A4DB8269119Dd19D1C`](https://testnet.monadscan.com/address/0xF9d1265d4f87B993244008A4DB8269119Dd19D1C#code) | [MonadScan Verified Contract](https://testnet.monadscan.com/address/0xF9d1265d4f87B993244008A4DB8269119Dd19D1C#code) |
| **Mock Token A (mWMON)** | [`0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0`](https://testnet.monadscan.com/address/0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0#code) | [MonadScan Verified Contract](https://testnet.monadscan.com/address/0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0#code) |
| **Mock Token B (mUSDT)** | [`0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD`](https://testnet.monadscan.com/address/0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD#code) | [MonadScan Verified Contract](https://testnet.monadscan.com/address/0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD#code) |
| **Reference AI Agent** | [`0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd`](https://testnet.monadscan.com/address/0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd) | Registered Agent ID `2372` on ERC-8004 |

---

## Architecture Overview

```mermaid
graph TD
    subgraph Users ["User Layer (Dual Identity Paths)"]
        UserA["Identity Path A: EOA / Mera Wallet<br>(MetaMask, Rabby, Secp256k1)"]
        UserB["Identity Path B: WebAuthn Passkey<br>(Hardware P-256 / TouchID / FaceID)"]
    end

    subgraph Core ["AgentGuard Core Contract (Monad Testnet)"]
        VaultAccounting["Internal Vault Balances<br>(Fee-on-Transfer Delta Accounting)"]
        PolicyEngine["Policy & Delegation Engine<br>• 24h Rolling Budget<br>• Per-Trade Limit<br>• Rate Floor (minRate)<br>• Target & Selector Allowlist"]
        Precompile["RIP-7212 P-256 Precompile (0x0100)<br>Low-s Non-Malleability Verification"]
        EmergencyExit["Sovereign Exit Gate<br>(Always Callable Even When Paused)"]
    end

    subgraph Agents ["Autonomous Execution"]
        AgentBackend["AI Agent Backend<br>(FastAPI / web3.py)<br>Executes with decisionHash"]
    end

    subgraph Venues ["External Trading Venues"]
        MockDEX["Trading Venue / DEX Router<br>(Exact Approval -> Call -> Zero Approval)"]
    end

    UserA -->|Direct Deposit & RegisterSession| VaultAccounting
    UserA -->|Direct Revoke & Withdraw| EmergencyExit
    UserB -->|Relayed WebAuthn Assertion| Precompile
    Precompile -->|Validate Signature & Nonce| PolicyEngine
    AgentBackend -->|execute(ExecuteParams)| PolicyEngine
    PolicyEngine -->|Exact Approval & Call| MockDEX
```

---

## Reference Agent Integration

Aegis-Monad includes a FastAPI reference trading agent (`backend/` and `examples/agent-integration.py`) demonstrating how any backend service interacts with `AgentGuard` using Python and `web3.py`:

1. Queries `getSession(user, agent)` to verify active authorization.
2. Inspects `getLimit()` and `windowRemaining()` to ensure proposed trades fit within the user's rolling 24-hour spending budget.
3. Formulates DEX swap calldata with slippage protection.
4. Executes trades through `AgentGuard.execute(ExecuteParams)` containing an immutable `decisionHash` for offchain auditability.

See [`docs/INTEGRATION.md`](./docs/INTEGRATION.md) and [`examples/agent-integration.py`](./examples/agent-integration.py) for the complete runnable implementation.

---

## Honest Limitations

1. **Testnet Only:** Aegis-Monad is currently deployed exclusively on Monad Testnet (`Chain ID 10143`).
2. **Mock DEX & Tokens:** The live testnet deployment uses vetted mock tokens (`mWMON`, `mUSDT`) and a `MockDEX` venue designed to model production DEX routing safely without testnet liquidity volatility.
3. **Unaudited Code:** The smart contracts and SDK have not been audited by a formal security firm. Do NOT deploy to Ethereum or Monad mainnet with real capital without an audit. See [`docs/SECURITY.md`](./docs/SECURITY.md).
4. **Relayer Censorship:** Passkey users rely on relayers to broadcast assertions. While relayers cannot steal funds or alter payloads, they can temporarily delay transactions. Users can always revoke or withdraw directly via an EOA or backup key if a relayer is offline.
5. **Mera Helper Status (`EXPERIMENTAL / UNTESTED`):** The Mera PRF passkey-derived EOA helper (`@aegis-monad/sdk/mera`) is tested via unit and mocked PRF tests in Vitest, but real hardware passkey PRF flow has not been verified on physical hardware in this environment. It is explicitly designated as `EXPERIMENTAL / UNTESTED`.

---

## Documentation

- **[INTEGRATION.md](./docs/INTEGRATION.md):** 10-line quickstarts, agent integration guide, and policy model.
- **[API.md](./docs/API.md):** Complete TypeScript SDK reference.
- **[SECURITY.md](./docs/SECURITY.md):** Threat model, adversary capabilities, passkey rationale, and invariants.
- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md):** Deep-dive architecture and component diagrams.
- **[VERIFIED.md](./docs/VERIFIED.md):** Verified testnet addresses, transaction proofs, and precompile checks.
