# Aegis-Monad Security & Threat Model

This document outlines the security architecture, threat model, cryptographic invariants, and operational boundaries of Aegis-Monad for application developers and integrators.

---

## 1. Threat Model & Adversary Capabilities

### A. Malicious or Compromised AI Agent

An AI agent has delegated authority to execute trades through `AgentGuard.execute()`.

| What a Malicious Agent CAN Do | What a Malicious Agent CANNOT Do |
| :--- | :--- |
| Attempt trades up to the user's `perTradeLimit` | Exceed the configured `perTradeLimit` |
| Attempt trades up to the rolling `dailyLimit` | Exceed the rolling 24-hour spending budget |
| Select unfavorable trades within allowed rate floors | Violate `minRate` floors configured by user |
| Waste their own transaction gas on reverted calls | Breach user slippage limits (`minAmountOut`) |
| Trade authorized tokens on authorized venues | Trade unauthorized tokens (`dailyLimit == 0`) |
| | Call unauthorized contracts or disallowed function selectors |
| | Withdraw tokens from the vault to any address |
| | Access or affect funds belonging to another user |
| | Trade after session expiration or after user revocation |

### B. Malicious or Compromised Target Venue (DEX / Router)

A venue called by `AgentGuard` via an authorized function selector.

| What a Malicious Venue CAN Do | What a Malicious Venue CANNOT Do |
| :--- | :--- |
| Consume transaction gas up to the gas limit | Pull more than the exact `amountIn` approved |
| Perform arbitrary internal state changes on its own contracts | Retain token approval (allowance is strictly zeroed post-call) |
| Revert execution | Steal tokens without delivering at least `minAmountOut` |
| | Reenter `AgentGuard` (`execute`, `deposit`, `withdraw` are nonReentrant) |
| | Corrupt internal accounting of other users or tokens |

### C. Malicious or Reentrant ERC-20 Token

A token deposited into or traded via `AgentGuard`.

| What a Malicious Token CAN Do | What a Malicious Token CANNOT Do |
| :--- | :--- |
| Charge transfer fees (fee-on-transfer) | Corrupt internal balances (deposits measure actual received deltas) |
| Revert during transfers | Mint unbacked internal vault balances |
| Attempt reentrancy during transfer hooks | Reenter `AgentGuard` (all state-changing methods are nonReentrant) |
| | Drain other users' balances |

### D. Malicious or Front-Running Relayer

A third party that submits passkey WebAuthn assertions on behalf of users.

| What a Malicious Relayer CAN Do | What a Malicious Relayer CANNOT Do |
| :--- | :--- |
| Submit valid passkey assertions and pay gas | Forge passkey signatures (hardware-bound P-256 keypair) |
| Delay, reorder, or censor assertion transactions | Tamper with payloads (policy, amounts, recipients) |
| | Replay past authorizations (enforced by monotonic nonces) |
| | Replay assertions across chains (`block.chainid` bound in challenge) |
| | Replay assertions across contracts (`address(this)` bound in challenge) |
| | Submit expired assertions (`deadline` strictly enforced) |

---

## 2. Key Security Properties & Design Rationale

### ERC-8004 Registration: Provenance vs. Trustworthiness

> [!IMPORTANT]
> ERC-8004 registration proves **identity provenance**, NOT **trustworthiness** or algorithmic reliability.

The ERC-8004 Identity Registry guarantees that `ownerOf(agentId) == agentAddress`. This establishes an onchain link between the agent's code/service and its onchain identity. It does **not** certify that the agent makes good trading decisions.

All safety is enforced deterministically by `AgentGuard`'s onchain policy engine, never by assumptions about agent behavior.

### WebAuthn `rpIdHash` and `origin` Verification

`AgentGuard.sol` verifies:
- Authenticator flags: `User Present (UP = bit 0)` and `User Verified (UV = bit 2)` (`0x05`).
- The challenge hash embedded inside `clientDataJSON`.
- Cryptographic P-256 signature via Monad's RIP-7212 `0x0100` precompile.
- Low-$s$ signature normalization ($s \le N/2$).

`AgentGuard` does **not** enforce a specific `rpIdHash` or web `origin` onchain.

**Why this is acceptable:**
1. In WebAuthn, hardware authenticators (Secure Enclaves, YubiKeys, Windows Hello) enforce origin scoping at the browser/OS level. An authenticator will never sign a challenge requested by `evil.com` using a credential created on `myapp.com`.
2. Omitting hardcoded origins allows multiple apps, frontends, and mobile wrappers to interact with the same passkey identity without requiring contract redeployments.

**Optional Hardening for Integrators:**
If an enterprise deployment requires domain-locking, integrators can enforce `rpIdHash` verification by passing `expectedRpIdHash` inside the assertion payload and verifying `keccak256(authenticatorData[0:32]) == expectedRpIdHash`.

### ECDSA Malleability & Low-$s$ Enforcement

Every ECDSA signature on SECP256R1 has a symmetric pair $(r, s)$ and $(r, N - s)$. If a contract accepts $s > N/2$, an attacker or relayer can invert $s$ to create a valid alternate signature with the same hash, potentially bypassing duplicate signature checks.

`AgentGuard` strictly rejects any signature where $s > N/2$:
```solidity
uint256 public constant SECP256R1_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
uint256 public constant SECP256R1_N_DIV_2 = SECP256R1_N >> 1;

if (uint256(auth.s) > SECP256R1_N_DIV_2) revert InvalidSignatureS();
```
The TypeScript SDK automatically normalizes all DER signatures using `parseDerSignature` before submission.

### 30-Day Session Duration Cap

To prevent indefinite delegation, `AgentGuard` enforces that `expiresAt <= block.timestamp + 30 days`. Sessions cannot be created with infinite lifespans.

### Emergency Unpause & Sovereign Exit

Even if the contract is paused by administrators via OpenZeppelin's `Pausable`:
- `withdraw()` and `withdrawWithPasskey()` remain **ALWAYS CALLABLE**.
- `revokeSession()` and `revokeSessionWithPasskey()` remain **ALWAYS CALLABLE**.

Users can never have their assets frozen by administrative pause.

---

## 3. Audit Status & Disclaimer

> [!WARNING]
> **UNAUDITED TESTNET SOFTWARE**
> The Aegis-Monad contracts and SDK are currently deployed on **Monad Testnet** for evaluation, hackathons, and developer feedback. They have **NOT** been audited by a third-party security firm.
> Do NOT deploy these contracts to Ethereum mainnet or Monad mainnet with real financial assets without a formal security audit.
