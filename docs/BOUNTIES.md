# Target Bounties & Track Objectives

## Primary Track: Trust, Identity & AI Infrastructure (Monad Metropolis)
**Prize Pool:** $30,000 USD (Split among top 3 teams)
**Evaluation Criteria:**
- **Technical Execution (20%):** Correct WebAuthn/P256 implementation, sound cryptographic key derivation, zero leaked secrets, resilient smart contract security.
- **Design & Craft (20%):** Developer experience, comprehensive documentation, clean and intuitive APIs, composable primitives.
- **Originality (15%):** Privacy-preserving, permissionless, decentralized infrastructure not capturable by a single centralized vendor.
- **Founder & Market Readiness (25%):** Clear market need, viable go-to-market strategy, productized primitive.
- **Traction (20%):** Working reference implementation, testnet transaction volume, real-world utility.

### Focus Statement
> "The urgent infrastructure needs created by AI regarding identity, provenance, data ownership, and agent trust. Passkey-native accounts, agent identity & reputation systems (ERC-8004), and verifiable agent execution."

Aegis-Monad addresses this track directly by providing an open delegation primitive: non-custodial smart vaults where human principals set cryptographic constraints (spending caps, allowlisted targets, rate floors) verified by passkeys, enabling AI agents (identified via ERC-8004) to autonomously execute onchain actions within verifiable safety bounds.

---

## Sponsor Bounty 1: Envio — Best Use of Envio
**Prize:** $1,000 USD + Free Envio Cloud Hosting
**Requirement:**
> "Build an application or indexer leveraging Envio HyperIndex or HyperSync on Monad Testnet to provide fast, reliable, and real-time indexed data for smart contract events and state transitions."

**Aegis Integration:**
Envio HyperIndex indexes:
- Agent session registrations and revocations
- Policy violations and budget exhaustion warnings
- Every executed trade with its associated offchain `decisionHash` for auditable agent history

---

## Sponsor Bounty 2: Alibaba Cloud Model Studio — Qwen Autonomous Agentic Reasoning
**Bounty Focus:**
> "Push Alibaba's Qwen reasoning models (Qwen 3.8 Max / Qwen-Plus) into genuinely agentic territory: autonomous planning, tool usage (onchain reads via RPC, DEX quote analysis, and transaction generation), and executing multi-step workflows without human intervention."

**Aegis Integration:**
The reference FastAPI backend integrates Qwen via DashScope's OpenAI-compatible endpoint to analyze token pair dynamics, formulate structured trading intents with `decisionHash`, and interact with Aegis-Monad's bounded execution engine.

---

## Sponsor Bounty 3: Kuru — CLOB & DEX Integration
**Bounty Focus:**
> "Leverage Kuru's central limit orderbook (CLOB) and routing engine on Monad testnet for liquidity provision, algorithmic trading, or automated order execution."

**Aegis Integration:**
Aegis allows users to delegate authority to AI agents to execute trades on Kuru's testnet Router and OrderBook, enforcing per-trade and daily token spending caps and minimum price slippage floors on every swap.
