import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Sliders, ShieldCheck, Key, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

import { parseEther, type Address, type Hex } from "viem";
import { PolicyBuilder, computePolicyHash } from "@aegis-monad/sdk";
import { useAegis } from "../context/AegisContext";
import { registerSessionWithPasskeyViaRelay, revokeSessionWithPasskeyViaRelay } from "../services/aegis";
import { CONFIG, getExplorerTxUrl } from "../config";

export const PolicyView: React.FC = () => {
  const { account, session, refreshSession } = useAegis();

  // Policy Form State
  const [perTradeLimit, setPerTradeLimit] = useState<string>("2.0");
  const [dailyLimit, setDailyLimit] = useState<string>("10.0");
  const [durationDays, setDurationDays] = useState<number>(7);
  const [minRate, setMinRate] = useState<string>("1.0");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute Expiry Date string
  const expiryDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + durationDays);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [durationDays]);

  // Compute Policy and Deterministic Policy Hash
  const { policy, policyHash } = useMemo(() => {
    try {
      const pIn = parseEther(perTradeLimit || "0");
      const pDay = parseEther(dailyLimit || "0");
      const pRate = parseEther(minRate || "1.0");
      const durationSec = BigInt(Math.max(1, Math.min(30, durationDays))) * 86400n;

      const built = new PolicyBuilder(
        CONFIG.agent.address as Address,
        BigInt(CONFIG.agent.agentId),
        durationSec
      )
        .allowToken(CONFIG.contracts.tokens.tokenA, pDay, pIn)
        .allowSelector(CONFIG.contracts.venue, CONFIG.contracts.venueSelectors.swap as Hex, true)
        .setMinRate(CONFIG.contracts.tokens.tokenA, CONFIG.contracts.tokens.tokenB, pRate)
        .build();

      const hash = computePolicyHash(built);
      return { policy: built, policyHash: hash };
    } catch {
      return { policy: null, policyHash: "0x0000000000000000000000000000000000000000000000000000000000000000" };
    }
  }, [perTradeLimit, dailyLimit, durationDays, minRate]);

  // Submit Policy Registration
  const handleSubmitPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account?.address || !policy) return;

    try {
      setIsLoading(true);
      setErrorMsg(null);
      setSuccessTx(null);

      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + durationDays * 86400);

      if (account.type === "passkey") {
        // Biometric assertion relayed onchain
        const res = await registerSessionWithPasskeyViaRelay({
          userId: account.address,
          agent: CONFIG.agent.address as Address,
          agentId: BigInt(CONFIG.agent.agentId),
          expiresAt,
          policy,
        });
        setSuccessTx(res.tx_hash);
      } else {
        throw new Error("EOA direct policy registration requires an active walletClient signer.");
      }

      await refreshSession();
    } catch (err: unknown) {
      console.error("Policy registration failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Revoke Session
  const handleRevokeSession = async () => {
    if (!account?.address) return;
    try {
      setIsRevoking(true);
      setErrorMsg(null);
      setSuccessTx(null);

      if (account.type === "passkey") {
        const res = await revokeSessionWithPasskeyViaRelay(
          account.address,
          CONFIG.agent.address as Address
        );
        setSuccessTx(res.tx_hash);
      } else {
        throw new Error("EOA direct revocation requires an active walletClient signer.");
      }

      await refreshSession();
    } catch (err: unknown) {
      console.error("Revocation failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsRevoking(false);
    }
  };

  if (!account) {
    return (
      <div className="max-w-[640px] mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-outline mx-auto mb-4">
          <Sliders className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">Connect Your Account</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Connect your passkey to authorize bounded delegation policies for the AI agent.
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
    <div className="max-w-[840px] mx-auto py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-on-surface">Policy Builder</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Give Autonomous Agent #{CONFIG.agent.agentId} a bounded budget and cryptographic trading bounds.
          </p>
        </div>

        {session && session.active && !session.isExpired && (
          <button
            onClick={handleRevokeSession}
            disabled={isRevoking}
            className="bg-error text-on-error text-xs font-medium px-5 py-2.5 rounded-full hover:opacity-90 active:scale-95 transition-all inline-flex items-center space-x-2 shrink-0 disabled:opacity-50"
          >
            {isRevoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Revoke Active Session</span>
          </button>
        )}
      </div>

      {/* Form Card */}
      <form onSubmit={handleSubmitPolicy} className="bg-surface-bright border border-outline-variant rounded-card p-8 card-elevation space-y-6 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Per Trade Limit */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Per-Trade Limit (mWMON)
            </label>
            <input
              type="text"
              value={perTradeLimit}
              onChange={(e) => setPerTradeLimit(e.target.value)}
              placeholder="2.0"
              className="w-full bg-surface border border-outline-variant rounded-control px-4 py-2.5 text-xs font-mono text-on-surface"
            />
            <span className="text-[11px] text-outline mt-1 block">Maximum tokens spent in a single trade</span>
          </div>

          {/* Daily Limit */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Rolling 24h Daily Limit (mWMON)
            </label>
            <input
              type="text"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="10.0"
              className="w-full bg-surface border border-outline-variant rounded-control px-4 py-2.5 text-xs font-mono text-on-surface"
            />
            <span className="text-[11px] text-outline mt-1 block">Window automatically rolls every 24 hours</span>
          </div>

          {/* Duration Days */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Duration in Days (Max 30)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="w-full bg-surface border border-outline-variant rounded-control px-4 py-2.5 text-xs font-mono text-on-surface"
            />
            <span className="text-[11px] text-outline mt-1 block">Authority strictly auto-expires on {expiryDate}</span>
          </div>

          {/* Rate Floor */}
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Minimum Rate Floor (mUSDT / mWMON)
            </label>
            <input
              type="text"
              value={minRate}
              onChange={(e) => setMinRate(e.target.value)}
              placeholder="1.0"
              className="w-full bg-surface border border-outline-variant rounded-control px-4 py-2.5 text-xs font-mono text-on-surface"
            />
            <span className="text-[11px] text-outline mt-1 block">Slippage guardrail: transactions below this price revert</span>
          </div>
        </div>

        {/* Allowed Venue Readonly */}
        <div className="p-4 rounded-panel bg-surface-container border border-outline-variant text-xs font-mono space-y-1">
          <div className="text-outline uppercase text-[10px] font-semibold">Authorized Execution Target</div>
          <div className="text-on-surface break-all">Venue: {CONFIG.contracts.venue} (MockDEX)</div>
          <div className="text-on-surface-variant">Allowed Selector: {CONFIG.contracts.venueSelectors.swap} (swap)</div>
        </div>

        {/* Human-Readable Summary */}
        <div className="p-5 rounded-panel bg-surface border-2 border-primary/20 text-xs leading-relaxed space-y-2">
          <div className="font-semibold text-on-surface flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Human-Readable Policy Summary</span>
          </div>
          <p className="text-on-surface-variant">
            &ldquo;The agent may swap up to <strong>{perTradeLimit} mWMON</strong> per trade and <strong>{dailyLimit} mWMON</strong> per day
            on MockDEX until <strong>{expiryDate}</strong>. You can revoke any time.&rdquo;
          </p>
        </div>

        {/* Exact Computed Policy Hash */}
        <div className="p-4 rounded-panel bg-surface-dark text-gray-300 font-mono text-xs space-y-1">
          <div className="text-gray-400 text-[10px] uppercase">Exact Cryptographic Policy Hash (signed onchain):</div>
          <div className="text-emerald-400 break-all select-all">{policyHash}</div>
        </div>

        {/* Feedbacks */}
        {successTx && (
          <div className="p-4 rounded-panel bg-success-container border border-success-border text-xs text-success flex items-start space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="break-all">
              <span>Transaction confirmed! </span>
              <a href={getExplorerTxUrl(successTx)} target="_blank" rel="noreferrer" className="underline font-mono">
                View on MonadScan ({successTx.slice(0, 10)}...)
              </a>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 rounded-panel bg-error-container border border-error-border text-xs text-error flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || !policy}
          className="w-full bg-primary text-on-primary font-medium text-sm py-4 px-6 rounded-full hover:opacity-90 active:scale-95 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Prompting Biometrics & Submitting Policy...</span>
            </>
          ) : (
            <>
              <Key className="w-4 h-4" />
              <span>Authorize Policy with Passkey</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
