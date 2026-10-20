import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  Key,
  Sliders,
  Cpu,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Lock,
  ArrowRight,
  AlertTriangle,
  Zap,
  Terminal,
} from "lucide-react";
import { Navbar } from "../components/Navbar";
import { CONFIG, getExplorerAddressUrl } from "../config";

export const LandingPage: React.FC = () => {
  const [copiedCode, setCopiedCode] = useState(false);

  const quickstartCode = `// 1. Initialize Aegis SDK on Monad Testnet
import { createAegisClient, PolicyBuilder, DEPLOYED_ADDRESSES } from "@aegis-monad/sdk";
import { parseEther } from "viem";

const aegis = createAegisClient({ publicClient, walletClient });

// 2. Deposit tokens into your non-custodial vault
await aegis.deposit(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("1.0"));

// 3. Define bounded delegation policy (limits, venue, slippage floor)
const policy = new PolicyBuilder(agentAddress, agentId, 86400n * 7n)
  .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
  .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
  .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1.0"))
  .build();

// 4. Grant authority onchain with atomic policy registration
const { hash } = await aegis.grantAgent(policy);`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(quickstartCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="min-h-screen bg-surface font-sans text-on-surface flex flex-col selection:bg-accent-primary/20">
      <Navbar />

      <main className="flex-1">
        {/* HERO SECTION */}
        <section className="max-w-[1280px] mx-auto px-6 pt-24 pb-20 flex flex-col items-center text-center">
          {/* Release / Track Pill */}
          <div className="inline-flex items-center space-x-2 bg-surface-container px-4 py-1.5 rounded-full mb-8 border border-outline-variant transition-all hover:border-outline">
            <span className="bg-primary text-on-primary text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full">
              Live
            </span>
            <span className="text-xs font-medium text-on-surface">Monad Metropolis Hackathon · Identity & Trust</span>
            <ArrowRight className="w-3.5 h-3.5 text-outline" />
          </div>

          {/* Display Headline */}
          <h1 className="text-display-h1 text-4xl sm:text-6xl lg:text-[76px] font-semibold text-on-surface max-w-[960px] tracking-tight leading-[0.98] mb-8">
            Bounded, Revocable AI Agent Delegation on Monad
          </h1>

          {/* Subline */}
          <p className="text-body-lg text-lg sm:text-xl text-on-surface-variant max-w-[680px] leading-relaxed mb-12">
            Give autonomous AI agents bounded authority to manage funds without ever surrendering custody.
            Secured by WebAuthn passkeys, verified onchain via RIP-7212 precompiles, and enforceable by deterministic smart vaults.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 mb-20 w-full sm:w-auto">
            <Link
              to="/app"
              className="bg-primary text-on-primary font-medium text-sm px-8 py-4 rounded-full hover:opacity-90 active:scale-95 transition-all w-full sm:w-auto shadow-sm inline-flex items-center justify-center space-x-2"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/Neminath-jain/Metropolis-Hack"
              target="_blank"
              rel="noreferrer"
              className="bg-surface-bright border border-outline-variant text-on-surface font-medium text-sm px-8 py-4 rounded-full hover:bg-surface-container active:scale-95 transition-all w-full sm:w-auto inline-flex items-center justify-center space-x-2"
            >
              <span>Read Documentation</span>
              <ExternalLink className="w-4 h-4 text-outline" />
            </a>
          </div>

          {/* Hero Demo Graphic Panel */}
          <div className="w-full max-w-[1040px] bg-surface-bright border border-outline-variant rounded-card p-3 card-elevation">
            <div className="bg-surface-dark rounded-panel p-6 sm:p-8 text-left text-gray-200 border border-gray-800">
              <div className="flex items-center justify-between pb-6 border-b border-gray-800/80 mb-6">
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-xs font-mono text-gray-300 pl-2">
                    AgentGuard.sol · Autonomous Delegation Engine
                  </span>
                </div>
                <div className="inline-flex items-center space-x-2 text-xs font-mono bg-surface-darkcard px-3 py-1 rounded-full border border-gray-700/60">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-200">Policy Invariant Enforced</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
                <div className="p-4 rounded-lg bg-surface-darkcard border border-gray-800">
                  <div className="text-gray-300 mb-1">PER-TRADE CEILING</div>
                  <div className="text-lg font-semibold text-white">2.00 mWMON</div>
                  <div className="text-[11px] text-gray-400 mt-2">Hard-capped onchain</div>
                </div>

                <div className="p-4 rounded-lg bg-surface-darkcard border border-gray-800">
                  <div className="text-gray-300 mb-1">ROLLING 24H BUDGET</div>
                  <div className="text-lg font-semibold text-emerald-400">10.00 mWMON</div>
                  <div className="text-[11px] text-gray-400 mt-2">Window remaining: 100%</div>
                </div>

                <div className="p-4 rounded-lg bg-surface-darkcard border border-gray-800">
                  <div className="text-gray-300 mb-1">P-256 PRECOMPILE</div>
                  <div className="text-lg font-semibold text-accent-monad">0x0100 (RIP-7212)</div>
                  <div className="text-[11px] text-gray-400 mt-2">Biometric verification</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST STRIP (Factual, No Fake Logos) */}
        <section className="border-y border-surface-highest bg-surface-bright py-12">
          <div className="max-w-[1280px] mx-auto px-6">
            <p className="text-center text-xs font-semibold text-outline uppercase tracking-widest mb-8">
              Verified Onchain Architecture on Monad
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div className="p-4">
                <div className="text-xl sm:text-2xl font-semibold text-on-surface font-mono">10143</div>
                <div className="text-xs text-on-surface-variant mt-1">Monad Testnet Chain ID</div>
              </div>
              <div className="p-4">
                <div className="text-xl sm:text-2xl font-semibold text-on-surface font-mono">0x0100</div>
                <div className="text-xs text-on-surface-variant mt-1">RIP-7212 Native P256 Precompile</div>
              </div>
              <div className="p-4">
                <div className="text-xl sm:text-2xl font-semibold text-on-surface font-mono">ERC-8004</div>
                <div className="text-xs text-on-surface-variant mt-1">Verifiable Agent Identity Registry</div>
              </div>
              <div className="p-4">
                <div className="text-xl sm:text-2xl font-semibold text-on-surface font-mono">100%</div>
                <div className="text-xs text-on-surface-variant mt-1">Open Source & Non-Custodial</div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="max-w-[1280px] mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold uppercase tracking-widest text-outline">Deterministic Workflow</span>
            <h2 className="text-3xl sm:text-4xl font-semibold text-on-surface mt-2 mb-4">
              How Aegis Protects User Funds
            </h2>
            <p className="text-on-surface-variant text-base max-w-[560px] mx-auto">
              A 4-step trust architecture enabling autonomous agents to execute on user-defined bounds with continuous cryptographic verification.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Step 1 */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-6 flex flex-col justify-between hover:border-primary transition-colors">
              <div>
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary mb-6">
                  <Key className="w-6 h-6" />
                </div>
                <div className="text-xs font-mono text-outline mb-1">STEP 01</div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">Passkey Sign-In</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Authenticate with biometric hardware (Touch ID / Face ID). No seed phrases to store or leak. The P-256 public key is registered directly onchain.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-6 flex flex-col justify-between hover:border-primary transition-colors">
              <div>
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary mb-6">
                  <Sliders className="w-6 h-6" />
                </div>
                <div className="text-xs font-mono text-outline mb-1">STEP 02</div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">Configure Budget</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Set per-trade spending caps, 24-hour rolling daily limits, allowed DEX venues, and slippage rate floors. You sign only the policy hash.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-6 flex flex-col justify-between hover:border-primary transition-colors">
              <div>
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary mb-6">
                  <Cpu className="w-6 h-6" />
                </div>
                <div className="text-xs font-mono text-outline mb-1">STEP 03</div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">Agent Acts in Bounds</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  The AI agent monitors signals and executes trades via AgentGuard. Any call that breaches spending caps or calls unauthorized venues is halted.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-6 flex flex-col justify-between hover:border-primary transition-colors">
              <div>
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary mb-6">
                  <RefreshCw className="w-6 h-6" />
                </div>
                <div className="text-xs font-mono text-outline mb-1">STEP 04</div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">Revoke or Withdraw</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Immediate cancellation at any time with a single biometric gesture. Full withdrawals are always available directly to your wallet even if the system is paused.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FOR DEVELOPERS */}
        <section id="developers" className="border-t border-surface-highest bg-surface-bright py-24">
          <div className="max-w-[1280px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 flex flex-col space-y-6">
              <span className="text-xs font-semibold uppercase tracking-widest text-outline">Developer Experience</span>
              <h2 className="text-3xl sm:text-4xl font-semibold text-on-surface">
                Integrate in 10 Lines of Code
              </h2>
              <p className="text-on-surface-variant text-base leading-relaxed">
                Aegis-Monad exports a type-safe TypeScript SDK (<code className="font-mono text-xs bg-surface-container px-2 py-1 rounded">@aegis-monad/sdk</code>)
                and Python integration clients. Give any autonomous AI agent delegated onchain execution authority in seconds.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start space-x-3 text-sm text-on-surface-variant">
                  <Zap className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <span>Compatible with standard viem / wagmi wallet and public clients.</span>
                </div>
                <div className="flex items-start space-x-3 text-sm text-on-surface-variant">
                  <Lock className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <span>Deterministic policy hash computation and WebAuthn DER normalization.</span>
                </div>
                <div className="flex items-start space-x-3 text-sm text-on-surface-variant">
                  <Terminal className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <span>Canonical venue selector exports and event decoding utilities.</span>
                </div>
              </div>

              <div className="pt-4 flex items-center space-x-4">
                <a
                  href="https://github.com/Neminath-jain/Metropolis-Hack/blob/main/docs/INTEGRATION.md"
                  target="_blank"
                  rel="noreferrer"
                  className="bg-primary text-on-primary font-medium text-xs px-5 py-3 rounded-full hover:opacity-90 inline-flex items-center space-x-2"
                >
                  <span>Integration Guide</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <span className="text-xs font-mono text-outline">npm: @aegis-monad/sdk</span>
              </div>
            </div>

            {/* Code Panel */}
            <div className="lg:col-span-7 bg-surface-dark rounded-card p-6 shadow-xl border border-gray-800 text-gray-200">
              <div className="flex items-center justify-between pb-4 border-b border-gray-800 mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-outline/30" />
                  <div className="w-3 h-3 rounded-full bg-outline/30" />
                  <div className="w-3 h-3 rounded-full bg-outline/30" />
                  <span className="text-xs font-mono text-gray-400 pl-2">examples/eoa-quickstart.ts</span>
                </div>

                <button
                  onClick={handleCopyCode}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 transition-colors"
                  title="Copy Quickstart"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? "Copied" : "Copy"}</span>
                </button>
              </div>

              <pre className="text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed p-2">
                <code>{quickstartCode}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* SECURITY MODEL CARDS */}
        <section id="security" className="max-w-[1280px] mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold uppercase tracking-widest text-outline">Threat Model & Defense</span>
            <h2 className="text-3xl sm:text-4xl font-semibold text-on-surface mt-2 mb-4">
              Cryptographic Invariants & Limits
            </h2>
            <p className="text-on-surface-variant text-base max-w-[620px] mx-auto">
              Aegis is built with a zero-trust model toward both agents and relayers. Every limit is strictly enforced onchain.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Card 1: What Malicious Agent Cannot Do */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-error-container text-error flex items-center justify-center">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-on-surface">Malicious or Compromised Agent</h3>
                    <p className="text-xs text-outline">Autonomous execution actor</p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> exceed per-trade limits or 24h rolling budget caps.</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> trade unauthorized tokens or call unwhitelisted venues.</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> withdraw user funds or breach user slippage floors.</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> act after session expiry or post-revocation.</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-surface-highest text-xs text-outline">
                Source: docs/SECURITY.md Section 1.A
              </div>
            </div>

            {/* Card 2: What Malicious Relayer Cannot Do */}
            <div className="bg-surface-bright border border-outline-variant rounded-card p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-surface-container text-primary flex items-center justify-center">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-on-surface">Untrusted Gas Relayer</h3>
                    <p className="text-xs text-outline">Third-party submission proxy</p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> forge signatures (bound to hardware P-256 authenticators).</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> modify policy, amounts, recipients or deadlines.</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> replay authorizations (strict monotonic nonces).</span>
                  </div>
                  <div className="flex items-start space-x-2 text-on-surface-variant">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>CANNOT</strong> move funds on its own (only submits pre-signed client data).</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-surface-highest text-xs text-outline">
                Source: docs/SECURITY.md Section 1.D
              </div>
            </div>
          </div>

          {/* Honest Boundary Disclosure */}
          <div className="mt-8 p-6 rounded-card bg-surface-container border border-outline-variant flex items-start space-x-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-on-surface-variant leading-relaxed">
              <strong className="text-on-surface">Testnet Research Prototype & Operational Boundaries:</strong>
              {" "}This system is deployed on Monad Testnet for hackathon demonstration. It utilizes mock ERC-20 tokens (mWMON, mUSDT)
              and a reference mock DEX venue. The contracts are unaudited. The ERC-8004 Identity Registry proves agent code ownership
              and identity provenance, but not investment profitability. All financial safety relies solely on onchain policy invariants.
            </div>
          </div>
        </section>

        {/* LIVE DEPLOYMENTS PANEL */}
        <section id="deployments" className="border-t border-surface-highest bg-surface-bright py-20">
          <div className="max-w-[1280px] mx-auto px-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-widest text-outline">Transparency</span>
                <h2 className="text-2xl sm:text-3xl font-semibold text-on-surface mt-1">
                  Live Testnet Deployments
                </h2>
              </div>
              <a
                href={CONFIG.explorerBaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-primary hover:underline inline-flex items-center space-x-1"
              >
                <span>MonadScan Testnet Explorer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
              {/* AgentGuard */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">AgentGuard Contract</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.contracts.agentGuard)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.contracts.agentGuard}
                </a>
                <div className="text-[10px] text-emerald-600 mt-2">Verified Contract Code</div>
              </div>

              {/* Agent Registry */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">ERC-8004 Agent Registry</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.contracts.registry)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.contracts.registry}
                </a>
                <div className="text-[10px] text-on-surface-variant mt-2">Agent ID: #{CONFIG.agent.agentId}</div>
              </div>

              {/* MockDEX Venue */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">MockDEX Venue</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.contracts.venue)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.contracts.venue}
                </a>
                <div className="text-[10px] text-on-surface-variant mt-2">Selector: {CONFIG.contracts.venueSelectors.swap}</div>
              </div>

              {/* Token A */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">Token A (mWMON)</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.contracts.tokens.tokenA)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.contracts.tokens.tokenA}
                </a>
                <div className="text-[10px] text-on-surface-variant mt-2">Mock Testnet Asset</div>
              </div>

              {/* Token B */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">Token B (mUSDT)</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.contracts.tokens.tokenB)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.contracts.tokens.tokenB}
                </a>
                <div className="text-[10px] text-on-surface-variant mt-2">Mock Testnet Asset</div>
              </div>

              {/* Autonomous Agent */}
              <div className="bg-surface rounded-panel p-4 border border-outline-variant">
                <div className="text-outline text-[11px] mb-1">Reference AI Agent</div>
                <a
                  href={getExplorerAddressUrl(CONFIG.agent.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary hover:underline break-all"
                >
                  {CONFIG.agent.address}
                </a>
                <div className="text-[10px] text-on-surface-variant mt-2">FastAPI Backend Driver</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-surface-highest bg-surface-bright py-12 px-6">
        <div className="max-w-[1280px] mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-outline">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold">
              A
            </div>
            <span>Aegis-Monad · Open Delegation Primitive for Autonomous AI Agents</span>
          </div>

          <div className="flex items-center space-x-6">
            <a
              href="https://github.com/Neminath-jain/Metropolis-Hack"
              target="_blank"
              rel="noreferrer"
              className="hover:text-on-surface transition-colors"
            >
              GitHub Repository
            </a>
            <a
              href="https://github.com/Neminath-jain/Metropolis-Hack/blob/main/docs/INTEGRATION.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-on-surface transition-colors"
            >
              Developer Docs
            </a>
            <a
              href="https://github.com/Neminath-jain/Metropolis-Hack/blob/main/docs/SECURITY.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-on-surface transition-colors"
            >
              Security Model
            </a>
          </div>

          <div className="text-center md:text-right">
            <span>Monad Metropolis Hackathon · Unaudited Testnet Prototype</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
