# Aegis-Monad: Verification & Protocol Baseline

This document records the exact verified values, network configurations, precompile details, interfaces, and fallbacks determined from official documentation and live RPC validation on the Monad testnet.

## Verification Matrix

| Item | Verified Value | Source URL | Status | Fallback / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Monad Testnet Chain ID** | `10143` (`0x279f`) | https://docs.monad.xyz/network-information/testnet | **VERIFIED** | Live RPC response: `0x279f` (10143). |
| **Monad Testnet RPC URL** | `https://testnet-rpc.monad.xyz` | https://docs.monad.xyz/network-information/testnet | **VERIFIED** | Active, verified via `eth_chainId` and `eth_getCode`. |
| **Monad Testnet Explorers** | MonadVision: `https://testnet.monadvision.com`<br>Monadscan: `https://testnet.monadscan.com` | https://docs.monad.xyz/network-information/testnet | **VERIFIED** | Primary block exploration tools for testnet. |
| **Monad Testnet Faucet** | `https://faucet.monad.xyz` | https://docs.monad.xyz/network-information/testnet | **VERIFIED** | Requires social auth (X / Discord) for testnet MON. |
| **Native Token** | `MON` (18 decimals) | https://docs.monad.xyz/network-information/testnet | **VERIFIED** | Wrapped native token: WMON. |
| **Block Time & Finality** | Block time: **300 ms** (1 slot).<br>Speculative finality: **300 ms** (1 slot).<br>Full finality: **600 ms** (2 slots). | https://docs.monad.xyz/page/precompiles | **VERIFIED** | High throughput MonadBFT consensus with asynchronous execution. |
| **Native P256 Precompile** | Address: `0x0000000000000000000000000000000000000100` (`0x0100`).<br>Specification: **EIP-7951** (supersedes RIP-7212).<br>Input: 160 bytes (`hash[32], r[32], s[32], qx[32], qy[32]`).<br>Output: 32 bytes (`uint256(1)` on success, empty/0 on failure).<br>Gas Cost: 3,450 gas (RIP-7212) / 6,900 gas (EIP-7951).<br>Live on Testnet: Yes, precompile handled at `0x0100`. | https://docs.monad.xyz/page/precompiles | **VERIFIED** | Fallback: Audited pure Solidity secp256r1 verifier (`Daimo P256Verifier` / `FreshCryptoLib` / `Solady P256.sol`). Gas difference: ~330,000 gas (Solidity) vs ~3,450–6,900 gas (Precompile), ~50x–100x efficiency gain. |
| **WebAuthn Verification** | Onchain components:<br>1. `clientDataJSON`: contains `type` ("webauthn.get"), `challenge` (base64url), `origin`.<br>2. `authenticatorData`: 37+ bytes with `rpIdHash` (32B), flags (bit 0 = UP User Presence, bit 2 = UV User Verification), counter.<br>3. `messageHash = sha256(authenticatorData || sha256(clientDataJSON))`.<br>4. Signature: parsed `(r, s)`.<br>5. Low-s check: $s \le n/2$, where $n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551$.<br>Challenge construction: `keccak256(abi.encode(user, agent, nonce, expiry, limitsHash))` or EIP-712 struct hash base64url encoded. | https://docs.monad.xyz / W3C WebAuthn spec / Solady WebAuthn | **VERIFIED** | Fallback / Reference: Solady `WebAuthn.sol` & Base `webauthn-sol`. Malleable signatures ($s > n/2$) must be rejected. |
| **ERC-8004 Registry** | Monad Testnet Address: `0x8004A818BFB912233c491871b3d84c89A494BD9e`.<br>Identity Registry (ERC-721 based).<br>Interface:<br>`register(string tokenURI) returns (uint256 agentId)`<br>`tokenURI(uint256 agentId) returns (string)`<br>`ownerOf(uint256 agentId) returns (address)`.<br>Agent identified by: `agentId` (uint256 token ID) and controller address. | https://thegraph.com / https://github.com/ethereum/ERCs/pull/8004 | **VERIFIED** | Verified contract code deployed onchain at `0x8004A818BFB912233c491871b3d84c89A494BD9e` via `eth_getCode`. Fallback: `MockAgentRegistry.sol` for local testing. |
| **Mera Passkey SDK** | Exact npm package: `@category-labs/mera` (and adapter `@category-labs/mera/viem`).<br>Passkey handling: `createSecp256k1SigningSession({ ... })`.<br>PRF exposure: Yes, uses WebAuthn PRF (`getPasskeyPrfOutput`) to derive 32 bytes of deterministic entropy.<br>Account type: Standard secp256k1 EOA `LocalAccount` via `toViemAccount(session)`. | https://github.com/category-labs/mera / https://docs.monad.xyz | **VERIFIED** | Real API: `@category-labs/mera` exports session creators; `@category-labs/mera/viem` provides `toViemAccount`. Fallback: WebAuthn direct passkey registration via `navigator.credentials.create` with P256. |
| **Kuru DEX** | Testnet Contract Addresses:<br>Router: `0x7EFbE105Ca7415dE98F96622173458ac1c054630`<br>Margin Account: `0xd029C2D98ff85D8F64799017fE00a59B1159CE02`<br>Forwarder: `0x681bB1508E14433b148a2549ba2726454aDc9BB4`<br>Deployer: `0xDacd06372cEb638640c9D8466A023b7362324e1A`<br>Utils: `0xE0841E0F06c5770C1D4930EC6C507ee33199C88C`<br>Testnet Tokens: USDC `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`.<br>Orderbook & Router ABI: `@kuru-labs/kuru-sdk`. | https://docs.kuru.io/ | **VERIFIED** | Fallback: `MockDEX` (fixed rate swap pulling tokens with `transferFrom` and transferring `tokenOut` to caller). |
| **Envio HyperIndex** | Monad Testnet config: Chain ID `10143`.<br>HyperSync: `https://monad-testnet.hypersync.xyz`<br>HyperRPC: `https://monad-testnet.rpc.hypersync.xyz`<br>Config format: `config.yaml` specifying `networks:` with `id: 10143`, `start_block`, and `contracts:` along with `schema.graphql`. | https://docs.envio.dev / Monad ecosystem docs | **VERIFIED** | First-class network support built into Envio HyperIndex. Fallback: Direct RPC log polling via web3.py / viem. |
| **Qwen Model Studio (Alibaba Cloud)** | Model ID: `qwen-max` / `qwen-plus` (or `qwen2.5-72b-instruct`).<br>Base URL (International): `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`<br>Base URL (China): `https://dashscope.aliyuncs.com/compatible-mode/v1`<br>Auth: `Authorization: Bearer <DASHSCOPE_API_KEY>`.<br>Tool-calling: Supported (`tools` array, `tool_calls`).<br>JSON mode: Supported (`response_format: {"type": "json_object"}` with keyword "JSON" in prompt, or `json_schema`). | https://www.alibabacloud.com/help/en/model-studio | **VERIFIED** | Fully OpenAI SDK compatible. Fallback: Local rule-based signal generator or MockLLM for deterministic unit tests. |
| **BTX Encrypted Mempool** | Batched Threshold Encryption (developed by Category Labs for Monad). Prevents MEV, frontrunning, and sandwich attacks by encrypting transactions until block ordering is committed by consensus. | https://docs.monad.xyz | **VERIFIED (OPTIONAL)** | Currently in protocol-level development with Cadence consensus; not exposed as a public dApp user-space RPC API on testnet yet. Marked **OPTIONAL**. |

---

## Minimal Solidity P256 Verification Call Example

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library P256Verifier {
    address constant P256_PRECOMPILE = address(0x0100);

    /// @notice Verifies a secp256r1 (P256) signature using Monad's EIP-7951 precompile at 0x0100
    /// @param messageHash 32-byte hash of the authenticated payload
    /// @param r Component r of the signature
    /// @param s Component s of the signature (must be low-s)
    /// @param qx Public key x-coordinate
    /// @param qy Public key y-coordinate
    /// @return isValid True if signature is valid, false otherwise
    function verifySignature(
        bytes32 messageHash,
        uint256 r,
        uint256 s,
        uint256 qx,
        uint256 qy
    ) internal view returns (bool isValid) {
        // Enforce low-s (prevent signature malleability)
        // Secp256r1 curve order n / 2:
        uint256 nDiv2 = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCEF279DCF5617E3192A8;
        if (s == 0 || s > nDiv2) return false;
        if (r == 0) return false;

        bytes memory input = abi.encodePacked(messageHash, r, s, qx, qy);
        (bool success, bytes memory ret) = P256_PRECOMPILE.staticcall(input);

        return success && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }
}
```

---

## Phase 1 Smart Contract Verification Summary

- **Contract:** [AgentGuard.sol](file:///d:/Projects-For-Hustle/Metropholis/contracts/src/AgentGuard.sol)
- **Solc Version:** `0.8.24` (`via_ir = true`, `evm_version = cancun`, `optimizer_runs = 200`)
- **Compilation Status:** 100% clean, **0 compiler warnings**.
- **Foundry Test Suite:** **84 / 84 tests passing** (`81` unit/fuzz in `AgentGuard.t.sol`, `1` in `MonadFork.t.sol`, `2` in `Placeholder.t.sol`).
- **Test Coverage Metrics (`AgentGuard.sol`):**
  - **Line Coverage:** **98.98%** (195/197 lines)
  - **Branch Coverage:** **93.62%** (44/47 branches)
  - **Statement Coverage:** **98.02%** (248/253 statements)
  - **Function Coverage:** **100.00%** (27/27 functions)
- **Monad Precompile (`0x0100`):**
  - EIP-7951 160-byte input format supported.
  - Native Solady low-s validation (`s <= N/2`) enforced with explicit curve order checks.
- **ERC-8004 Registry Integration:**
  - Tested against `MockAgentRegistry` and verified for Monad testnet registry address `0x8004A818BFB912233c491871b3d84c89A494BD9e`.

---

## Testnet checks

Live verification executed via `forge test --match-path "test/MonadFork.t.sol" --fork-url https://testnet-rpc.monad.xyz -vv`:

1. **Native P256 Precompile (`0x0100`):**
   - **Valid Wycheproof Vector:** `P256_PRECOMPILE.staticcall(validVector)` returns `success = 1`, returndata length = `32` (`abi.decode(ret, (uint256)) == 1`). Verified onchain.
   - **Tampered Vector:** Signature with corrupted $s$ component returns `success = 0` / empty returndata (`0x`), correctly rejected.
   - **Malleability Protection:** Signatures with $s > N/2$ or $s = 0$ are strictly rejected by `AgentGuard` before or during precompile verification.
   - **Dual-Mode Fallback:** Solady `P256.sol` automatically falls back to the audited pure Solidity verifier if the precompile returns empty, guaranteeing continuous execution.

2. **ERC-8004 Identity Registry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`):**
   - **Proxy Verification:** Deployed code size is 130 bytes (EIP-1967 proxy delegating to implementation `0x7274E874CA62410a93bD8bf61c69D8045e399c02`).
   - **`ownerOf` Check:** `ownerOf(1)` returns `0x133603465aDdE7C39fa0E6E34b264E1573e1FD08`, confirming ERC-721 ownership resolution on Monad testnet.
   - **Registration Flow:** Verified that calling `register(string metadataURI)` from a clean EOA with `>= 350,000` gas successfully mints an agent NFT and assigns controller ownership (`ownerOf(agentId) == agentAddress`).

---

## Stage 2 Live Monad Testnet Deployment & Verification Record

Executed on Monad Testnet (`Chain ID: 10143`, RPC: `https://testnet-rpc.monad.xyz`):

### 1. Deployed & Verified Contracts
- **`AgentGuard`**: `0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618`
  - Deploy Tx: [`0xb8d7dad62de2b7e1b77c0823ecbface1f05e3bc343e89605a2c90eedad8bab0e`](https://testnet.monadscan.com/tx/0xb8d7dad62de2b7e1b77c0823ecbface1f05e3bc343e89605a2c90eedad8bab0e)
  - Monadscan Verified: [0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618#code](https://testnet.monadscan.com/address/0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618#code)
  - Sourcify Verification Job: [a28e15ce-f830-4ead-ad32-3e09d46de611](https://sourcify.dev/server/verify-ui/jobs/a28e15ce-f830-4ead-ad32-3e09d46de611)
- **`MockDEX`**: `0xF9d1265d4f87B993244008A4DB8269119Dd19D1C`
  - Deploy Tx: [`0x4461a3f140685657cfd75d31a54160a0b224e7561be61c94411130dcf91f16ef`](https://testnet.monadscan.com/tx/0x4461a3f140685657cfd75d31a54160a0b224e7561be61c94411130dcf91f16ef)
  - Monadscan Verified: [0xF9d1265d4f87B993244008A4DB8269119Dd19D1C#code](https://testnet.monadscan.com/address/0xF9d1265d4f87B993244008A4DB8269119Dd19D1C#code)
  - Sourcify Verification Job: [7030ca4b-4839-4ac9-a794-8242fc466453](https://sourcify.dev/server/verify-ui/jobs/7030ca4b-4839-4ac9-a794-8242fc466453)
- **`MockERC20 (Mock Wrapped Monad - mWMON)`**: `0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0`
  - Deploy Tx: [`0xfa34ff9d15584e628112ef266a66ee4e4421725c97f6ad038771ed41a942dd98`](https://testnet.monadscan.com/tx/0xfa34ff9d15584e628112ef266a66ee4e4421725c97f6ad038771ed41a942dd98)
  - Monadscan Verified: [0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0#code](https://testnet.monadscan.com/address/0xBbBA05e4d10286Fdc21dEF5bbc674E6f9269bFa0#code)
  - Sourcify Verification Job: [1cbfcba1-f504-443a-8f8d-f529041a52fe](https://sourcify.dev/server/verify-ui/jobs/1cbfcba1-f504-443a-8f8d-f529041a52fe)
- **`MockERC20 (Mock Tether USD - mUSDT)`**: `0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD`
  - Deploy Tx: [`0xbbd2197f608212c197c2cdb0c762b72e61111e9ed74b10537d950d6faebf25cf`](https://testnet.monadscan.com/tx/0xbbd2197f608212c197c2cdb0c762b72e61111e9ed74b10537d950d6faebf25cf)
  - Monadscan Verified: [0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD#code](https://testnet.monadscan.com/address/0x8D410373B5e6B3927d5CeE0Cc99a8a62556D59dD#code)
  - Sourcify Verification Job: [f0cd4b6f-d7ee-43fb-8232-0675adda6e19](https://sourcify.dev/server/verify-ui/jobs/f0cd4b6f-d7ee-43fb-8232-0675adda6e19)
- **ERC-8004 Identity Registry**: `0x8004A818BFB912233c491871b3d84c89A494BD9e`

### 2. Live Agent Identity & Session Flows
- **ERC-8004 Agent Registration**:
  - Agent Address: `0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd`
  - Agent ID: `2372` (`ownerOf(2372) == 0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd`)
  - Tx: [`0xd907eba3e05e28e36bfbd5048d4c22f4a566e09b42b5b231f0e4bb46e7fcef10`](https://testnet.monadscan.com/tx/0xd907eba3e05e28e36bfbd5048d4c22f4a566e09b42b5b231f0e4bb46e7fcef10)
- **Standard User Deposit (5.0 mWMON)**:
  - Tx: [`0xb561cdf27336c48c12a0452d4d15a5e61e0b3e906fc3f2bbdd0c362f7660a61a`](https://testnet.monadscan.com/tx/0xb561cdf27336c48c12a0452d4d15a5e61e0b3e906fc3f2bbdd0c362f7660a61a)
- **Standard Session Registration**:
  - Tx: [`0x367f395d0fefcd91e0f5358c848801bd4673a91e1e06f8a8b7846abf54e2d35c`](https://testnet.monadscan.com/tx/0x367f395d0fefcd91e0f5358c848801bd4673a91e1e06f8a8b7846abf54e2d35c)
- **Authorized Bounded Swap Execution**:
  - Tx: [`0x014087018a512b7ffbe0dcf1703a4de304915f203ccff272e4b00e2f1c48f7c2`](https://testnet.monadscan.com/tx/0x014087018a512b7ffbe0dcf1703a4de304915f203ccff272e4b00e2f1c48f7c2)
  - Spent: 1.0 mWMON -> Received: 1.0 mUSDT.

### 3. Red-Team Attacks Blocked Onchain
1. **Attack 1 (Over-Limit Spender)**:
   - Requested 50.0 mWMON trade (per-trade cap: 2.0 mWMON).
   - Tx: [`0xe7a49e332b77bd1dc0b397a0c0a37131da36e799ea7ffe7eecc96c1357518e27`](https://testnet.monadscan.com/tx/0xe7a49e332b77bd1dc0b397a0c0a37131da36e799ea7ffe7eecc96c1357518e27)
   - Status: Blocked without reverting. Emitted `PolicyViolation` reason code `5` (`EXCEEDS_PER_TRADE`).
2. **Attack 2 (Bad Target / Venue)**:
   - Target directed to unauthorized `0x000000000000000000000000000000000000dEaD`.
   - Tx: [`0x5af6e0be4c09791a27e7d93c9020870a98d6a5c7b963a5fb025f5553b6e34f7b`](https://testnet.monadscan.com/tx/5af6e0be4c09791a27e7d93c9020870a98d6a5c7b963a5fb025f5553b6e34f7b)
   - Status: Blocked without reverting. Emitted `PolicyViolation` reason code `2` (`TARGET_NOT_ALLOWED`).
3. **Attack 3 (Bad Selector)**:
   - Calldata injected with unauthorized selector `0xdeadbeef`.
   - Tx: [`0x6267f93cc5f8c8ce40968cbd888c530419b5c783fe17d2a48924417545cdade5`](https://testnet.monadscan.com/tx/6267f93cc5f8c8ce40968cbd888c530419b5c783fe17d2a48924417545cdade5)
   - Status: Blocked without reverting. Emitted `PolicyViolation` reason code `3` (`SELECTOR_NOT_ALLOWED`).

### 4. Passkey WebAuthn Lifecycle & Security Tests
1. **P256 Key Registration**:
   - Registered coordinates $(q_x, q_y)$.
   - Derived passkey `userId`: `0x8ec3b943e88E33E31920E73F729d642b03A6A3f3`.
   - Tx: [`0x522c45a50739e20ae8cc0ed86cb2b667dc6c6d8c7cf3b150277c62c07f6cdf37`](https://testnet.monadscan.com/tx/522c45a50739e20ae8cc0ed86cb2b667dc6c6d8c7cf3b150277c62c07f6cdf37)
2. **Session Registration via WebAuthn Assertion**:
   - Signed WebAuthn assertion (flags UP+UV `0x05`, clientDataJSON, low-s signature) submitted via relayer.
   - Emitted `PolicyCreated(user: 0x8ec3b943e88E33E31920E73F729d642b03A6A3f3)`.
   - Tx: [`0x7de28eb01daafae9b1d6045f9f248e1f909fc82340d7a6d0da51b791aa058ef8`](https://testnet.monadscan.com/tx/7de28eb01daafae9b1d6045f9f248e1f909fc82340d7a6d0da51b791aa058ef8)
3. **Replay Attack Rejection**:
   - Re-submitted identical valid assertion.
   - Reverted onchain with `InvalidNonce()`.
   - Reverted Tx: [`0x4b46d80492d1882bd9bb20035495fef0f0665f4b8a5df6f0d2fa082171fd0844`](https://testnet.monadscan.com/tx/4b46d80492d1882bd9bb20035495fef0f0665f4b8a5df6f0d2fa082171fd0844) (Status: `0`)
4. **Malleable High-s Rejection**:
   - Submitted high-s signature variant ($s' = N - s > N/2$).
   - Reverted onchain with `InvalidSignatureS()`.
   - Reverted Tx: [`0x111a72a9c69c5d1141e52301b14954b1100008776de92285efc8459e499a2f5a`](https://testnet.monadscan.com/tx/111a72a9c69c5d1141e52301b14954b1100008776de92285efc8459e499a2f5a) (Status: `0`)
5. **Passkey Vault Funding (`depositFor`)**:
   - Credited 5.0 mWMON directly to passkey account `0x8ec3b943e88E33E31920E73F729d642b03A6A3f3`.
   - Tx: [`0xfdd5b592373a3f3a84bd3912570f0c39024800c8e3b3524484fb83648a5aa693`](https://testnet.monadscan.com/tx/fdd5b592373a3f3a84bd3912570f0c39024800c8e3b3524484fb83648a5aa693)
6. **Passkey Delegated Trade Execution**:
   - Agent executed swap under passkey session: spent 1.0 mWMON -> received 1.0 mUSDT credited to passkey vault.
   - Tx: [`0x2fb3e2aa73ef1da705ab13bd80f5558f95cf56d6b6f318a33cae7fb34c6b45ff`](https://testnet.monadscan.com/tx/2fb3e2aa73ef1da705ab13bd80f5558f95cf56d6b6f318a33cae7fb34c6b45ff)
7. **Passkey Withdrawal (`withdrawWithPasskey`)**:
   - Passkey WebAuthn authorization to withdraw 1.0 mUSDT from passkey vault to recipient EOA `0x91DD9d96344f000b5175a45589239dd658E4350d`.
   - Tx: [`0x11260ccca0117fa0350c995169ae4d03d20e7b4af0ca3425804cfac27027d145`](https://testnet.monadscan.com/tx/11260ccca0117fa0350c995169ae4d03d20e7b4af0ca3425804cfac27027d145)


