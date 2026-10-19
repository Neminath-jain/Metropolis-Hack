# Aegis-Monad Developer Integration Guide

Aegis-Monad provides an open, non-custodial delegation primitive and policy engine on Monad testnet (`Chain ID 10143`). It enables applications to give AI agents bounded, revocable authority over ERC-20 funds in approximately **10 lines of code**.

---

## 1. Ten-Line Quickstarts

### Identity Path A: EOA / Mera-Derived Wallet

Apps whose users connect with MetaMask, Rabby, or a Mera PRF-derived EOA use this path.

```typescript
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAegisClient, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";

// --- 10 LINES OF INTEGRATION CODE START ---
const publicClient = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const walletClient = createWalletClient({ account: privateKeyToAccount(USER_PRIVATE_KEY), transport: http("https://testnet-rpc.monad.xyz") });
const aegis = createAegisClient({ publicClient, walletClient });

// 1. Deposit into vault & wait for receipt
await aegis.deposit(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("5.0"));

// 2. Build delegation policy with 24h & per-trade spending limits
const policy = new PolicyBuilder(DEPLOYED_ADDRESSES.agent.address, BigInt(DEPLOYED_ADDRESSES.agent.agentId), 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
  .build();

// 3. Register session & verify onchain
await aegis.registerSession(policy);
const session = await aegis.getSession(walletClient.account.address, DEPLOYED_ADDRESSES.agent.address);
// --- 10 LINES OF INTEGRATION CODE END ---

console.log("Session Active:", session.active); // true
```

### Identity Path B: WebAuthn Passkeys (Hardware P-256)

Apps targeting mainstream users who do not have seed phrases or crypto wallets use this path. Users create a biometric passkey (FaceID, TouchID, Windows Hello) scoped to the web origin. The P-256 public key is verified natively onchain by Monad's RIP-7212 `0x0100` precompile.

```typescript
import { createPublicClient, http, parseEther } from "viem";
import { createAegisClient, createPasskey, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";

// --- 10 LINES OF INTEGRATION CODE START ---
const publicClient = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const aegis = createAegisClient({ publicClient });

// 1. Create biometric passkey in browser & register onchain (relayer pays gas)
const { qx, qy, userId } = await createPasskey({ rpName: "DeFi Copilot" });
await relayerWallet.writeContract({ address: aegis.guardAddress, abi: AGENT_GUARD_ABI, functionName: "registerPasskey", args: [qx, qy] });

// 2. Build delegation policy
const policy = new PolicyBuilder(DEPLOYED_ADDRESSES.agent.address, BigInt(DEPLOYED_ADDRESSES.agent.agentId), 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
  .build();

// 3. Sign biometric assertion and submit gaslessly via relayer
await aegis.registerSessionWithPasskey({ userId, agent: policy.agent, agentId: policy.agentId, expiresAt: policy.expiresAt, policy, relayerWalletClient });
// --- 10 LINES OF INTEGRATION CODE END ---
```

---

## 2. How an AI Agent Backend Integrates

Once a user delegates authority, the agent backend (such as a FastAPI Python service, LangChain worker, or autonomous trading bot) operates autonomously without touching the user's private keys.

### Execution Workflow

```
[User App]                       [Agent Backend]                     [Monad Testnet / AgentGuard]
    |                                   |                                         |
    |---- 1. Register Session --------->|                                         |
    |                                   |                                         |
    |                                   |---- 2. getSession(user, agent) -------->|
    |                                   |     Verify active, not expired          |
    |                                   |                                         |
    |                                   |---- 3. windowRemaining(user, token) --->|
    |                                   |     Inspect remaining budget & balance  |
    |                                   |                                         |
    |                                   |---- 4. execute(ExecuteParams) --------->|
    |                                   |     AgentGuard verifies:                |
    |                                   |       • Target allowed                  |
    |                                   |       • Selector allowed                |
    |                                   |       • amount <= perTradeLimit         |
    |                                   |       • spentInWindow + amount <= daily |
    |                                   |       • minRate floor satisfied         |
    |                                   |       • Slippage floor delivered        |
    |                                   |<--- 5. ActionExecuted (or Violation) --|
```

### Python Integration Example (`web3.py`)

```python
from web3 import Web3
from eth_abi import encode

w3 = Web3(Web3.HTTPProvider("https://testnet-rpc.monad.xyz"))
guard = w3.eth.contract(address=GUARD_ADDRESS, abi=GUARD_ABI)

# 1. Verify session is active
is_active, expires_at, agent_id = guard.functions.getSession(user_addr, agent_addr).call()
assert is_active and expires_at > time.time(), "Session inactive"

# 2. Check remaining 24-hour spending budget
budget, seconds_left = guard.functions.windowRemaining(user_addr, agent_addr, token_a).call()
trade_amount = int(0.5 * 10**18)
assert trade_amount <= budget, "Trade exceeds rolling budget"

# 3. Formulate DEX calldata
swap_calldata = bytes.fromhex("8a0ccd56") + encode(
    ["address", "uint256", "address", "uint256"],
    [token_a, trade_amount, token_b, min_amount_out]
)

# 4. Submit bounded execution
execute_params = (
    user_addr, token_a, trade_amount, token_b, min_amount_out,
    venue_addr, swap_calldata, decision_hash
)
estimated_gas = guard.functions.execute(execute_params).estimate_gas({"from": agent_addr})
tx = guard.functions.execute(execute_params).build_transaction({
    "from": agent_addr,
    "nonce": w3.eth.get_transaction_count(agent_addr, "pending"),
    # On Monad, fees are charged on gas_limit (not gas_used). Keep buffer tight at 10%.
    "gas": int(estimated_gas * 1.10),
    "gasPrice": w3.eth.gas_price,
    "chainId": 10143,
})
signed = agent_account.sign_transaction(tx)
w3.eth.send_raw_transaction(signed.raw_transaction)
```

> **Important: Monad Gas Charging Model (`docs.monad.xyz`)**
> Unlike Ethereum where unused gas is refunded based on `gasUsed`, Monad charges transaction fees strictly based on the declared **`gas_limit`**:
> $$\text{Fee} = \text{Gas Limit} \times \text{Price per Gas}$$
> Because Monad decouples consensus from execution via asynchronous execution, block space is a reservation that must be accounted for by validators at proposal time. Setting an unnecessarily inflated gas limit results in deadweight loss and excess fee expenditure. Best practice for Monad integrations is to run `eth_estimateGas` and apply a tight **10% safety buffer**.

---

## 3. The Policy Model in Plain Language

Aegis-Monad's policy model is built on five strict safety invariants designed so that users retain sovereign control over their funds at all times:

1. **Non-Custodial Rolling Vault**:
   Funds remain accounted to the user's ledger inside `AgentGuard`. The agent cannot withdraw tokens, transfer tokens to arbitrary addresses, or access any other user's balance.

2. **Per-Trade & Rolling 24-Hour Limits**:
   - `perTradeLimit`: Caps the maximum tokens consumed in a single execution.
   - `dailyLimit`: Caps total spending over a rolling 24-hour window. Spending metrics automatically reset as time elapses without requiring onchain maintenance.
   - Invariant: `perTradeLimit <= dailyLimit`.

3. **Strict Target & Selector Allowlisting**:
   Agents can only call pre-vetted contracts (`targets`) and pre-authorized function selectors (e.g. `swap(address,uint256,address,uint256)`). Any call to an unapproved target or selector is immediately blocked.

4. **Rate Floors & Post-Call Slippage Enforcers**:
   - `minRate`: Enforces minimum exchange ratios between pairs (e.g. 1 WMON must yield at least 0.95 USDT).
   - Balance Delta Verification: Post-execution, `AgentGuard` checks that `balanceAfter - balanceBefore >= minAmountOut`. If the venue shorts the user, the entire transaction reverts.

5. **Instant Revocation & Emergency Withdrawal**:
   Users can call `revokeSession(agent)` or `withdraw(token, amount, to)` at any time—**even when the contract is paused by administrators**. Emergency self-custody is permanently inviolable.
