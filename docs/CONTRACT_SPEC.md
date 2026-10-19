# AgentGuard Protocol Specification & Threat Model

Aegis-Monad is an open, non-custodial delegation primitive on Monad (Chain ID: 10143) enabling any decentralized application or user to grant an AI agent bounded, revocable authority over ERC-20 tokens.

---

## 1. Threat Model & Security Guarantees

AgentGuard operates under a zero-trust model where AI agents, execution venues, and relayers are presumed potentially compromised or adversarial.

| Threat Actor | Capabilities | Deterministic Onchain Constraints |
| :--- | :--- | :--- |
| **Malicious / Compromised AI Agent** | Attempt arbitrary swaps, off-market pricing, or drained funds | - Cannot exceed user-configured `perTradeLimit`<br>- Cannot exceed rolling 24-hour `dailyLimit`<br>- Cannot trade unconfigured tokens (`dailyLimit == 0`)<br>- Cannot call unvetted contracts or unapproved function selectors<br>- Cannot breach user slippage (`minAmountOut`) or exchange rate floor (`minRate`)<br>- Cannot access funds belonging to any other user<br>- Cannot execute trades after expiration or user revocation<br>- Cannot withdraw or transfer vault funds (withdrawals are strictly user-authorized) |
| **Malicious Execution Target (DEX / Venue)** | Reentrancy attacks, overpulling tokens, or short deliveries | - Exact approvals: `forceApprove(target, amountIn)` is granted immediately before call and strictly reset to `0` post-call<br>- Post-call spent invariant: reverts `SpentMoreThanAuthorized` if target pulls $> amountIn$<br>- Post-call delivery invariant: reverts `SlippageExceeded` if received $< minAmountOut$ or $== 0$<br>- Reentrancy protection: `execute`, `deposit`, and `withdraw` are guarded by OpenZeppelin `nonReentrant` |
| **Fee-on-Transfer / Non-standard Tokens** | Deduct transfer tax on deposit or withdraw | - Vault balance is credited based on actual delta (`balanceAfter - balanceBefore`), preventing internal unbacked credits<br>- Nominal amount requested is not assumed to equal net received tokens |
| **Malicious Relayer** | Submit user passkey transactions, reorder, or censor | - Cannot forge P256 biometric signatures<br>- Cannot modify payload, amounts, tokens, or recipients (challenge hash binds all payload fields)<br>- Cannot replay transactions (monotonically increasing passkey `nonce`)<br>- Cannot replay across chains (`block.chainid` bound in challenge)<br>- Cannot replay across contracts (`address(this)` bound in challenge)<br>- Cannot execute expired signatures (`deadline` verified) |
| **Signature Malleability Exploits** | Submit high-$s$ counterpart signature ($s' = N - s$) | - Strictly enforces $s \le N/2$ (`SECP256R1_N_DIV_2`), reverting with `InvalidSignatureS()` |

---

## 2. Core Architecture & Data Model

### Vault Accounting
```solidity
mapping(address => mapping(address => uint256)) public balances;
```
- Completely non-custodial.
- Tokens are held directly in AgentGuard; user balances are tracked individually.
- Users can deposit directly (`deposit`) or fund any address/passkey (`depositFor`).
- Withdrawals (`withdraw` and `withdrawWithPasskey`) are **ALWAYS available**, even when the contract is paused by the owner.

### Delegation Session
```solidity
struct Session {
    bool active;
    uint64 expiresAt;
    uint256 agentId;
}
mapping(address => mapping(address => Session)) public sessions;
```
- Binds a user to an `agent` address and an ERC-8004 `agentId`.
- Maximum session duration is capped at **30 days** into the future.
- Revocable at any moment by the user via EOA (`revokeSession`) or Passkey (`revokeSessionWithPasskey`), even when paused.

### Token Limits & Rolling 24-Hour Windows
```solidity
struct TokenLimit {
    uint128 dailyLimit;
    uint128 perTradeLimit;
    uint128 spentInWindow;
    uint64 windowStart;
}
mapping(address => mapping(address => mapping(address => TokenLimit))) public tokenLimits;
```
- Each token must have `dailyLimit > 0` and `perTradeLimit <= dailyLimit` to be tradable.
- When `block.timestamp >= windowStart + 1 days`, `spentInWindow` automatically resets to 0 and `windowStart` updates to the current timestamp.
- Trades fail gracefully (returning `false` and emitting `PolicyViolation`) if `amountIn > perTradeLimit` or `spentInWindow + amountIn > dailyLimit`.

---

## 3. WebAuthn P256 / Passkey Identity Verification

AgentGuard natively supports WebAuthn passkeys using Monad's **EIP-7951 P256 precompile at `0x0100`** via Solady `WebAuthn.sol` and `P256.sol`:

1. **Passkey Registration:**
   - User registers coordinates $(q_x, q_y)$ via `registerPasskey(qx, qy)`.
   - Deterministic account identity: `userId = address(uint160(uint256(keccak256(abi.encode(qx, qy)))))`.
2. **Challenge Binding:**
   - Challenge hash cryptographically binds action typehash, `block.chainid`, `address(this)`, `userId`, `payloadHash`, `nonce`, and `deadline`.
3. **Assertion Verification:**
   - `WebAuthn.verify` ensures `clientDataJSON` type is `"webauthn.get"`, challenge matches, and User Presence (UP bit 0) and User Verification (UV bit 2) are enforced.
   - Low-$s$ validation enforces $0 < s \le N/2$ before delegating to `0x0100`.

---

## 4. ERC-8004 Identity Registry Verification

- During session registration, AgentGuard queries the ERC-8004 registry:
  ```solidity
  try registry.ownerOf(agentId) returns (address owner) {
      if (owner != agent) revert AgentOwnerMismatch(agentId, agent, owner);
  } catch {
      revert AgentNotRegistered(agentId);
  }
  ```
- **Security Note for Judges:** ERC-8004 registration proves onchain identity *ownership*, not algorithmic benevolence. Safety is enforced deterministically by AgentGuard's hard policy caps.

---

## 5. Execution Flow & Invariant Guarantees

```mermaid
flowchart TD
    A[Agent Calls execute(params)] --> B{_validatePreCall}
    B -- Check Fails --> C[Emit PolicyViolation & Return false]
    B -- Check Passes --> D[Approve Target exact amountIn]
    D --> E[Low-Level Call to Target]
    E --> F[Reset Allowance to 0]
    F --> G{Post-Call Invariants}
    G -- spent > amountIn --> H[Revert SpentMoreThanAuthorized]
    G -- received < minAmountOut --> I[Revert SlippageExceeded]
    G -- received * 1e18 < spent * floorRate --> J[Revert BelowUserRateFloor]
    G -- Valid --> K[Update Internal Balances & spentInWindow]
    K --> L[Emit ActionExecuted & Return true]
```

- Pre-call failures return `false` without reverting, saving gas and emitting indexed violation telemetry for HyperIndex.
- Post-call invariant breaches revert the transaction, preventing loss of funds.
