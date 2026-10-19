# Aegis-Monad: Complete Setup & Run Guide

This runbook provides the full end-to-end setup guide to build, test, and run the **Aegis-Monad** monorepo on **Monad Testnet (Chain ID: 10143)**.

---

## 1. System Prerequisites

Ensure you have the following toolchain installed on your machine:

| Tool | Recommended Version | Verification Command | Installation Guide |
| :--- | :--- | :--- | :--- |
| **Foundry** | `v1.8.5+` | `forge --version` | [getfoundry.sh](https://getfoundry.sh/) |
| **Node.js** | `v18+` or `v20+` | `node -v` | [nodejs.org](https://nodejs.org/) |
| **npm** | `v9+` or `v10+` | `npm -v` | Bundled with Node.js |
| **Python** | `3.11+` | `python --version` | [python.org](https://www.python.org/) |
| **Git** | `v2.40+` | `git --version` | [git-scm.com](https://git-scm.com/) |

> [!TIP]
> **Windows Users:** If running Foundry inside PowerShell, make sure your Foundry bin directory is available in your `$env:Path`:
> ```powershell
> $env:Path = "C:\Users\<username>\.foundry\bin;" + $env:Path
> ```

---

## 2. Monorepo Architecture Overview

```
Metropholis/
├── contracts/          # Foundry: AgentGuard.sol, mocks, and 84 unit/fuzz tests
├── backend/            # FastAPI: Qwen/DashScope trading agent & Monad web3.py integration
├── sdk/                # TypeScript: Client library for passkey delegation & vault management
├── frontend/           # Vite + React + Tailwind: Passkey dashboard & policy manager
├── indexer/            # Envio HyperIndex: Monad testnet event indexer configuration
├── docs/               # Architecture docs (CONTRACT_SPEC.md, INTEGRATION.md, VERIFIED.md)
└── README.md           # Project roadmap & bounty alignment
```

---

## 3. Quickstart (Clone & Install All Dependencies)

```bash
# 1. Clone the repository
git clone https://github.com/Neminath-jain/Metropolis-Hack.git
cd Metropolis-Hack

# 2. Install Smart Contract dependencies (OpenZeppelin, Solady, Forge-Std)
cd contracts
forge install
cd ..

# 3. Install Backend Python dependencies
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 4. Install SDK dependencies
cd sdk
npm install
npm run build
cd ..

# 5. Install Frontend dependencies
cd frontend
npm install
cd ..
```

---

## 4. Smart Contracts (`contracts/`)

The core primitive is [AgentGuard.sol](file:///d:/Projects-For-Hustle/Metropholis/contracts/src/AgentGuard.sol), a non-custodial smart vault and policy delegation engine enforcing onchain limits on Monad.

### 4.1. Compile Contracts
Compile contracts with Solc `0.8.24` via-IR:
```bash
cd contracts
forge build
```
*Expected output: `Compiler run successful!` with 0 warnings.*

### 4.2. Run Full Test Suite
Execute the 84 unit, fuzz, evil DEX, and edge-case tests:
```bash
forge test -vv
```
*Expected output: `84 passed; 0 failed; 0 skipped`.*

### 4.3. Run Code Coverage
Verify that line and branch coverage exceed $> 90\%$:
```bash
forge coverage --ir-minimum --match-path "test/AgentGuard.t.sol"
```
*Expected output:*
- Line Coverage: `> 98%`
- Branch Coverage: `> 93%`
- Function Coverage: `100%`

### 4.4. Verify Formatting
```bash
forge fmt --check
```

### 4.5. Run Live Monad Testnet Fork Test (Optional)
Test interaction against the live Monad testnet RPC and the onchain ERC-8004 registry:
```bash
forge test --fork-url https://testnet-rpc.monad.xyz -vv
```

### 4.6. Deploy to Monad Testnet
To deploy `AgentGuard` to the Monad testnet:
```bash
# Set your deployer private key
export DEPLOYER_KEY="0x..."

forge create src/AgentGuard.sol:AgentGuard \
  --rpc-url https://testnet-rpc.monad.xyz \
  --chain-id 10143 \
  --private-key $DEPLOYER_KEY \
  --constructor-args <OWNER_ADDRESS> 0x8004A818BFB912233c491871b3d84c89A494BD9e
```

---

## 5. Backend AI Agent (`backend/`)

The backend is a high-performance FastAPI service that uses Alibaba Cloud Model Studio (Qwen-Max) to generate trade intents, compute cryptographic `decisionHash` audits, and dispatch transactions to `AgentGuard.execute`.

### 5.1. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your parameters:
```ini
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
CHAIN_ID=10143
AGENT_PRIVATE_KEY=0x<your_agent_private_key>
AGENT_GUARD_ADDRESS=0x<deployed_agent_guard_address>
FRONTEND_ORIGIN=http://localhost:5173
DASHSCOPE_API_KEY=your_dashscope_api_key_here
DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-max
```

> [!NOTE]
> If you do not have a DashScope API key, the backend automatically provides mock/rule-based signal fallbacks for testing.

### 5.2. Run Backend Unit Tests
```bash
python -m pytest backend/tests -v
```
*Expected output: `2 passed`.*

### 5.3. Launch the Backend API Server
```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- Interactive Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/health](http://localhost:8000/health)

---

## 6. TypeScript SDK (`sdk/`)

The TypeScript SDK provides a client library for web applications to interact with `AgentGuard` vaults, construct passkey authorizations, and format delegation policies.

### 6.1. Run SDK Tests
```bash
cd sdk
npm test
```
*Expected output: `3 passed`.*

### 6.2. Build SDK Package
```bash
npm run build
```
*Generates build artifacts in `sdk/dist/`.*

---

## 7. Frontend Dashboard (`frontend/`)

A modern web dashboard built with React 18, Vite, and Tailwind CSS.

### 7.1. Launch Development Server
```bash
cd frontend
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 7.2. Build for Production
```bash
npm run build
```
*Builds optimized static assets in `frontend/dist/`.*

---

## 8. End-to-End Walkthrough

Here is how an application interacts with Aegis-Monad onchain:

### Step 1: User Deposits Tokens
A user wraps native `MON` to `WMON` and deposits into `AgentGuard`:
```solidity
// Vault credits the exact delta received
IAgentGuard(guard).deposit(wmonAddress, 50 ether);
```

### Step 2: User Authorizes an Agent Session
User authorizes an agent (e.g. backend key) with a policy:
- **Daily Budget Cap:** 20 WMON
- **Per-Trade Cap:** 5 WMON
- **Allowed Target:** Kuru Router (`0x7EFbE105Ca7415dE98F96622173458ac1c054630`)
- **Allowed Selector:** `swap(address,uint256,address,uint256)`
- **Duration:** 7 days

Can be submitted as a direct EOA transaction (`registerSession`) or via WebAuthn passkey assertion (`registerSessionWithPasskey`).

### Step 3: Agent Executes Trades
The backend AI agent computes a trade decision, hashes the reasoning payload (`decisionHash`), and calls:
```solidity
IAgentGuard(guard).execute(ExecuteParams({
    user: userAddress,
    tokenIn: wmonAddress,
    amountIn: 2 ether,
    tokenOut: usdcAddress,
    minAmountOut: 8 ether,
    target: kuruRouter,
    data: swapData,
    decisionHash: decisionHash
}));
```
- `AgentGuard` enforces that `amountIn <= 5 ether` and `spentInWindow + 2 ether <= 20 ether`.
- Approves `2 ether` to `kuruRouter`, executes the call, and resets allowance to `0`.
- Verifies that output received $\ge 8\text{ ether}$.
- Emits `ActionExecuted` with `decisionHash`.

### Step 4: User Withdraws or Revokes
At any point, the user can revoke the agent session or withdraw funds:
```solidity
IAgentGuard(guard).revokeSession(agentAddress);
IAgentGuard(guard).withdraw(wmonAddress, 48 ether, userAddress);
```
*(Always available, even if the contract is paused).*

---

## 9. Verification & Protocol Reference Matrix

- **Network:** Monad Testnet
- **Chain ID:** `10143` (`0x279f`)
- **RPC URL:** `https://testnet-rpc.monad.xyz`
- **Native Precompile (P256 / EIP-7951):** `0x0000000000000000000000000000000000000100` (`0x0100`)
- **ERC-8004 Identity Registry:** `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- **Explorers:** [MonadVision](https://testnet.monadvision.com) / [Monadscan](https://testnet.monadscan.com)
- **Faucet:** [https://faucet.monad.xyz](https://faucet.monad.xyz)

For comprehensive technical and security documentation:
- Threat Model: [docs/CONTRACT_SPEC.md](file:///d:/Projects-For-Hustle/Metropholis/docs/CONTRACT_SPEC.md)
- Integration Quickstart: [docs/INTEGRATION.md](file:///d:/Projects-For-Hustle/Metropholis/docs/INTEGRATION.md)
- Testnet Baseline: [docs/VERIFIED.md](file:///d:/Projects-For-Hustle/Metropholis/docs/VERIFIED.md)
