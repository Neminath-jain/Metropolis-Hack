# Aegis-Monad System Architecture

Aegis-Monad is an open delegation primitive and policy engine for AI agents on Monad. It enforces cryptographic boundaries, spending limits, slippage floors, and execution allowlists between users, autonomous agents, and trading venues.

---

## Architecture Diagram

```mermaid
graph TD
    subgraph Users ["User Layer (Dual Identity Paths)"]
        UserA["Identity Path A: EOA / Mera Wallet<br>(MetaMask, Rabby, Secp256k1)"]
        UserB["Identity Path B: WebAuthn Passkey<br>(Hardware P-256 / TouchID / FaceID)"]
    end

    subgraph Relayer ["Gasless Relayer Layer"]
        RelayerNode["Relayer / Bundler<br>(Sponsors Gas for Passkey Users)"]
    end

    subgraph Core ["AgentGuard Core Contract (Monad Testnet)"]
        VaultAccounting["Internal Vault Balances<br>(Fee-on-Transfer Delta Accounting)"]
        PolicyEngine["Policy & Delegation Engine<br>• 24h Rolling Budget<br>• Per-Trade Limit<br>• Rate Floor (minRate)<br>• Target & Selector Allowlist"]
        Precompile["RIP-7212 P-256 Precompile (0x0100)<br>Low-s Non-Malleability Verification"]
        EmergencyExit["Sovereign Exit Gate<br>(Always Callable Even When Paused)"]
    end

    subgraph Registry ["Identity Provenance"]
        ERC8004["ERC-8004 Agent Registry<br>Verifies ownerOf(agentId) == agent"]
    end

    subgraph Agents ["Autonomous Execution"]
        AgentBackend["AI Agent Backend<br>(FastAPI / LangChain / web3.py)<br>Executes with decisionHash"]
    end

    subgraph Venues ["External Trading Venues"]
        MockDEX["Trading Venue / DEX Router<br>(Exact Approval -> Call -> Zero Approval)"]
        Tokens["ERC-20 Tokens<br>(mWMON, mUSDT)"]
    end

    subgraph Observers ["Realtime Indexing & Events"]
        Events["Onchain Event Streams<br>• PolicyCreated<br>• ActionExecuted<br>• PolicyViolation(reasonCode)<br>• SessionRevoked"]
    end

    %% Flows
    UserA -->|1. Direct Deposit & RegisterSession| VaultAccounting
    UserA -->|Direct Revoke & Withdraw| EmergencyExit
    UserB -->|1. Sign WebAuthn Assertion| RelayerNode
    RelayerNode -->|Submit registerSessionWithPasskey| Precompile
    Precompile -->|Validate Signature & Monotonic Nonce| PolicyEngine
    
    AgentBackend -->|2. Verify Session & Budget| PolicyEngine
    AgentBackend -->|3. Call execute(ExecuteParams)| PolicyEngine
    PolicyEngine -->|4. Verify ERC-8004 Provenance| ERC8004
    PolicyEngine -->|5. Exact Approval & Call| MockDEX
    MockDEX -->|Trade Tokens| Tokens
    PolicyEngine -->|6. Verify Post-Call Slippage| VaultAccounting
    PolicyEngine -->|7. Emit Telemetry| Events

    style UserA fill:#1e1b4b,stroke:#818cf8,stroke-width:2px;
    style UserB fill:#1e1b4b,stroke:#c084fc,stroke-width:2px;
    style PolicyEngine fill:#311042,stroke:#d946ef,stroke-width:2px;
    style VaultAccounting fill:#064e3b,stroke:#34d399,stroke-width:2px;
    style Precompile fill:#0f172a,stroke:#38bdf8,stroke-width:2px;
    style AgentBackend fill:#451a03,stroke:#fb923c,stroke-width:2px;
    style Events fill:#172554,stroke:#60a5fa,stroke-width:2px;
```

---

## Component Details

### 1. Dual Identity Paths

- **Identity Path A (EOA / Mera-Derived Wallet):**
  Users interact directly via standard EVM wallets or Mera PRF-derived accounts. They sign EVM transactions directly to `deposit()`, `registerSession()`, `revokeSession()`, and `withdraw()`.

- **Identity Path B (WebAuthn Passkeys via RIP-7212):**
  Users create hardware-backed P-256 keypairs scoped to their device. Their onchain `userId` is deterministically derived as `address(uint160(uint256(keccak256(abi.encode(qx, qy)))))`. All state modifications use WebAuthn assertions relayed gaslessly by third-party sponsors.

### 2. Policy Engine & Safety Enforcers

Every delegation policy contains:
- `tokens`: Configures `dailyLimit` and `perTradeLimit` per ERC-20.
- `targets`: Pre-approved contract addresses.
- `selectors`: Pre-approved 4-byte function selectors.
- `rates`: Minimum price floors for token pairs (scaled 1e18).
- `expiresAt`: UNIX timestamp capped at a maximum of 30 days.

### 3. Execution Pipeline

When an agent calls `AgentGuard.execute(ExecuteParams)`:
1. **Pre-call Validation:**
   - Checks that session is active and not expired.
   - Checks that `target` is on the user's allowlist AND globally approved.
   - Checks that `bytes4(data[0:4])` is an allowed selector.
   - Checks that `amountIn <= perTradeLimit`.
   - Checks that rolling 24-hour spending + `amountIn <= dailyLimit`.
   - Checks that `minRate` floor is satisfied.
   - If any pre-call check fails, `execute` returns `false` and emits `PolicyViolation(user, agent, reasonCode, decisionHash)` without reverting (saving transaction gas and notifying indexers).
2. **Exact Approval Execution:**
   - Temporarily approves the target venue for exactly `amountIn`.
   - Executes the low-level call to `target`.
   - Immediately resets allowance to `0`.
3. **Post-call Balance Verification:**
   - Verifies that `received >= minAmountOut`. If the venue returned fewer tokens, the entire transaction reverts.
   - Updates `spentInWindow` metrics.
   - Credits received tokens to the user's internal vault balance.
   - Emits `ActionExecuted(user, agent, target, tokenIn, tokenOut, spent, received, decisionHash)`.

### 4. Non-Reentrant Accounting & Invariants

- **Solvency Invariant:** For every token $T$, the real contract balance satisfies:
  $$\sum_{u} \text{balances}[u][T] \le \text{IERC20}(T).\text{balanceOf}(\text{address}(\text{this}))$$
- **Low-$s$ Invariant:** All WebAuthn signatures must satisfy $s \le N/2$ to eliminate signature malleability.
- **Replay Protection:** Monotonic nonces per passkey account (`passkeyNonce[userId]`) prevent replaying past authorizations.
