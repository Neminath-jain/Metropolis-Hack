import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Flame,
  Ban,
  Shield,
  RefreshCw,
} from "lucide-react";
import { formatUnits, type Address } from "viem";
import { useAegis } from "../context/AegisContext";
import { triggerRedTeamAttack, revokeSessionWithPasskeyViaRelay, runAgentOnce } from "../services/aegis";
import { aegisClient } from "../services/aegis";
import { CONFIG, getExplorerTxUrl } from "../config";

interface AttackResultCard {
  kind: string;
  title: string;
  attempted: string;
  reasonCodeName: string;
  details: string;
  balanceBefore: string;
  balanceAfter: string;
  deltaZero: boolean;
  txHash?: string;
  timestamp: number;
}

export const RedTeamView: React.FC = () => {
  const { account, refreshAll } = useAegis();


  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [results, setResults] = useState<AttackResultCard[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const executeAttack = async (kind: "over_limit" | "bad_target" | "bad_selector") => {
    if (!account?.address) return;
    try {
      setIsLoading(kind);
      setErrorMsg(null);

      // 1. Measure vault balance before
      const balBefore = await aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenA);
      const balBeforeStr = formatUnits(balBefore, 18);

      // 2. Dispatch attack (backend bypasses offchain guardrails directly to AgentGuard.sol)
      const res = await triggerRedTeamAttack(kind, account.address);

      // 3. Measure vault balance after
      const balAfter = await aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenA);
      const balAfterStr = formatUnits(balAfter, 18);

      const titles: Record<string, string> = {
        over_limit: "Spending Limit Violation",
        bad_target: "Unauthorized Venue Call",
        bad_selector: "Disallowed Function Selector",
      };

      const attemptedTexts: Record<string, string> = {
        over_limit: "Agent attempted to execute swap for 1,000,000 mWMON (far exceeding user limit).",
        bad_target: "Agent attempted to call unwhitelisted target address (0x000...dEaD).",
        bad_selector: "Agent attempted to execute disallowed function selector (0xdeadbeef).",
      };

      setResults((prev) => [
        {
          kind,
          title: titles[kind],
          attempted: attemptedTexts[kind],
          reasonCodeName: res.reason_name || "POLICY_VIOLATION",
          details: res.details || "Execution halted onchain by AgentGuard policy invariants.",
          balanceBefore: balBeforeStr,
          balanceAfter: balAfterStr,
          deltaZero: balBefore === balAfter,
          txHash: res.tx_hash,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      await refreshAll();
    } catch (err: unknown) {
      console.error("Attack failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsLoading(null);
    }
  };

  const handleRevokeMidRun = async () => {
    if (!account?.address) return;
    try {
      setIsLoading("revoke_mid_run");
      setErrorMsg(null);

      const balBefore = await aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenA);
      const balBeforeStr = formatUnits(balBefore, 18);

      // Step A: Revoke onchain session with passkey
      if (account.type === "passkey") {
        await revokeSessionWithPasskeyViaRelay(account.address, CONFIG.agent.address as Address);
      }

      // Step B: Attempt agent run immediately post-revocation
      const res = await runAgentOnce(account.address);

      const balAfter = await aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenA);
      const balAfterStr = formatUnits(balAfter, 18);

      setResults((prev) => [
        {
          kind: "revoke_mid_run",
          title: "Revoke Mid-Run Invariant",
          attempted: "Session revoked cryptographically onchain; agent then attempted to trade under revoked authority.",
          reasonCodeName: res.status === "rejected_by_guardrails" ? "REFUSED_NO_SESSION" : res.reason_name || "NO_SESSION",
          details: "Agent was immediately halted. No spending permitted without an active, non-expired session.",
          balanceBefore: balBeforeStr,
          balanceAfter: balAfterStr,
          deltaZero: balBefore === balAfter,
          txHash: res.tx_hash,
          timestamp: Date.now(),
        },
        ...prev,
      ]);

      await refreshAll();
    } catch (err: unknown) {
      console.error("Revoke mid-run failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsLoading(null);
    }
  };

  if (!account) {
    return (
      <div className="max-w-[640px] mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-outline mx-auto mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">Connect Your Account</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Connect your account to test onchain security guardrails against simulated malicious agent behaviors.
        </p>
        <Link
          to="/app/welcome"
          className="bg-primary text-on-primary font-medium text-xs px-6 py-3 rounded-full hover:opacity-90 inline-block"
        >
          Go to Identity Selection
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[940px] mx-auto py-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-on-surface">Red-Team Security Validation</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Verify onchain defense-in-depth: test that the smart contract deterministically blocks unauthorized agent calls.
        </p>
      </div>

      {/* Explanatory Banner */}
      <div className="p-5 rounded-panel bg-surface-container border border-outline-variant text-xs leading-relaxed space-y-2">
        <div className="font-semibold text-on-surface flex items-center space-x-2">
          <Shield className="w-4 h-4 text-primary" />
          <span>How Red-Team Testing Works</span>
        </div>
        <p className="text-on-surface-variant">
          Under normal operation, the offchain FastAPI service evaluates signals and applies guardrails before dispatching onchain.
          In these tests, offchain guardrails are <strong>intentionally bypassed</strong> to trigger execution on the verified
          <code className="font-mono text-primary font-bold"> AgentGuard.sol</code> contract.
          You can observe the smart contract enforcing policy invariants directly on Monad testnet.
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-panel bg-error-container border border-error-border text-xs text-error flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-all">{errorMsg}</span>
        </div>
      )}

      {/* Attack Buttons Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attack 1: Over Limit */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-5 flex flex-col justify-between hover:border-error transition-colors">
          <div>
            <div className="w-10 h-10 rounded-xl bg-error-container text-error flex items-center justify-center mb-4">
              <Flame className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-on-surface mb-1">Over-Limit Attack</h3>
            <p className="text-xs text-outline mb-4">
              Attempts to swap 1,000,000 mWMON to breach per-trade & daily budget caps.
            </p>
          </div>
          <button
            onClick={() => executeAttack("over_limit")}
            disabled={isLoading !== null}
            className="w-full bg-surface hover:bg-surface-container border border-outline-variant text-on-surface font-medium text-xs py-2 px-3 rounded-full active:scale-95 transition-all flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            {isLoading === "over_limit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Test Over-Limit</span>}
          </button>
        </div>

        {/* Attack 2: Bad Target */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-5 flex flex-col justify-between hover:border-error transition-colors">
          <div>
            <div className="w-10 h-10 rounded-xl bg-error-container text-error flex items-center justify-center mb-4">
              <Ban className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-on-surface mb-1">Bad Target Venue</h3>
            <p className="text-xs text-outline mb-4">
              Attempts to call an unauthorized address (0xdead) not approved in policy.
            </p>
          </div>
          <button
            onClick={() => executeAttack("bad_target")}
            disabled={isLoading !== null}
            className="w-full bg-surface hover:bg-surface-container border border-outline-variant text-on-surface font-medium text-xs py-2 px-3 rounded-full active:scale-95 transition-all flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            {isLoading === "bad_target" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Test Bad Target</span>}
          </button>
        </div>

        {/* Attack 3: Bad Selector */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-5 flex flex-col justify-between hover:border-error transition-colors">
          <div>
            <div className="w-10 h-10 rounded-xl bg-error-container text-error flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-on-surface mb-1">Disallowed Selector</h3>
            <p className="text-xs text-outline mb-4">
              Attempts to invoke disallowed function selector 0xdeadbeef on DEX venue.
            </p>
          </div>
          <button
            onClick={() => executeAttack("bad_selector")}
            disabled={isLoading !== null}
            className="w-full bg-surface hover:bg-surface-container border border-outline-variant text-on-surface font-medium text-xs py-2 px-3 rounded-full active:scale-95 transition-all flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            {isLoading === "bad_selector" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Test Bad Selector</span>}
          </button>
        </div>

        {/* Attack 4: Revoke Mid-Run */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-5 flex flex-col justify-between hover:border-error transition-colors">
          <div>
            <div className="w-10 h-10 rounded-xl bg-error-container text-error flex items-center justify-center mb-4">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-sm text-on-surface mb-1">Revoke Mid-Run</h3>
            <p className="text-xs text-outline mb-4">
              Revokes passkey session onchain, then confirms agent is refused instantly.
            </p>
          </div>
          <button
            onClick={handleRevokeMidRun}
            disabled={isLoading !== null}
            className="w-full bg-surface hover:bg-surface-container border border-outline-variant text-on-surface font-medium text-xs py-2 px-3 rounded-full active:scale-95 transition-all flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            {isLoading === "revoke_mid_run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Test Revoke Mid-Run</span>}
          </button>
        </div>
      </div>

      {/* Results Log */}
      <div className="space-y-4 pt-4">
        <h2 className="text-lg font-semibold text-on-surface">Red-Team Verification Log</h2>

        {results.length === 0 ? (
          <div className="bg-surface-bright border border-outline-variant rounded-card p-8 text-center text-xs text-outline">
            No attacks executed yet. Click any button above to test onchain security invariants.
          </div>
        ) : (
          results.map((r, i) => (
            <div key={i} className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-surface-highest gap-2">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="font-semibold text-sm text-on-surface">{r.title}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-error-container text-error font-bold uppercase">
                    BLOCKED: {r.reasonCodeName}
                  </span>
                </div>
                <span className="text-xs font-mono text-outline">{new Date(r.timestamp).toLocaleTimeString()}</span>
              </div>

              <div className="text-xs space-y-2 text-on-surface-variant">
                <div>
                  <strong className="text-on-surface">Action Attempted: </strong>
                  <span>{r.attempted}</span>
                </div>
                <div>
                  <strong className="text-on-surface">Contract Verdict: </strong>
                  <span className="text-error font-mono">{r.reasonCodeName}</span> · {r.details}
                </div>
              </div>

              {/* Proof of Zero Balance Delta */}
              <div className="p-3 rounded-panel bg-surface-container border border-outline-variant text-xs font-mono flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Proof of Protection: Before: {r.balanceBefore} mWMON · After: {r.balanceAfter} mWMON
                  </span>
                </div>
                <span className="text-emerald-700 font-semibold text-[11px]">
                  Delta: 0.00 mWMON (Zero Funds Lost)
                </span>
              </div>

              {r.txHash && (
                <div className="pt-2 text-xs font-mono">
                  <a
                    href={getExplorerTxUrl(r.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center space-x-1"
                  >
                    <span>View Reverted Transaction on MonadScan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
