import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Play,
  Loader2,
  ExternalLink,
  Wifi,
  WifiOff,
  ChevronRight,
} from "lucide-react";

import { useAegis } from "../context/AegisContext";
import { runAgentOnce, type ExecutionResult } from "../services/aegis";
import { CONFIG, getExplorerTxUrl } from "../config";

interface StreamMessage {
  type: string;
  timestamp: number;
  signals?: {
    token_in: string;
    token_out: string;
    price: number;
    rsi: number;
    macd: number;
    bollinger_upper: number;
    bollinger_lower: number;
    volume_24h: number;
    source: string;
  };
  decision?: {
    action: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    min_amount_out: number;
    rationale: string;
    confidence: number;
  };
  guardrails_passed?: boolean;
  result?: {
    status: string;
    tx_hash?: string;
    decision_hash?: string;
    details?: string;
    spent?: number;
    received?: number;
    reason_name?: string;
  };
}

export const DashboardView: React.FC = () => {
  const { account, session, windowInfo, formattedTokenA, formattedTokenB, refreshAll } = useAegis();

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastExecution, setLastExecution] = useState<ExecutionResult | null>(null);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Spent today percentage calculation
  const budgetRemaining = windowInfo ? parseFloat(windowInfo.formattedBudget) : 0;
  // If windowInfo is available, daily budget is e.g. 10.0
  const dailyTotal = 10.0;
  const spentToday = Math.max(0, dailyTotal - budgetRemaining);
  const spentPercent = Math.min(100, Math.max(0, (spentToday / dailyTotal) * 100));

  // Connect to WebSocket /agent/stream
  useEffect(() => {
    let unmounted = false;

    const connectWS = () => {
      try {
        const ws = new WebSocket(`${CONFIG.wsUrl}/agent/stream`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!unmounted) setWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (unmounted) return;
          try {
            const data = JSON.parse(event.data);
            setMessages((prev) => [
              {
                ...data,
                timestamp: Date.now(),
              },
              ...prev.slice(0, 19), // Keep latest 20 messages
            ]);
            // Refresh balances & window status when execution happens
            if (data.type === "run_once" || data.type === "attack") {
              refreshAll();
            }
          } catch (e) {
            console.warn("WS parse error:", e);
          }
        };

        ws.onclose = () => {
          if (!unmounted) {
            setWsConnected(false);
            // Reconnect after 3s
            setTimeout(connectWS, 3000);
          }
        };

        ws.onerror = () => {
          if (!unmounted) setWsConnected(false);
        };
      } catch (err) {
        console.warn("WebSocket init failed:", err);
      }
    };

    connectWS();

    return () => {
      unmounted = true;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [refreshAll]);

  // Run agent once trigger
  const handleRunAgentOnce = async () => {
    if (!account?.address) return;
    try {
      setIsRunning(true);
      const res = await runAgentOnce(account.address);
      setLastExecution(res);
      await refreshAll();
    } catch (err: unknown) {
      console.error("Agent run failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setLastExecution({
        status: "reverted",
        details: msg,
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (!account) {
    return (
      <div className="max-w-[640px] mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-outline mx-auto mb-4">
          <Activity className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">Connect Your Account</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Connect your passkey to view real-time agent metrics, spending windows, and live execution streams.
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
    <div className="max-w-[1040px] mx-auto py-6 space-y-8">
      {/* Top Header & Run Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-on-surface">Agent Monitoring Dashboard</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Real-time policy guardrails and autonomous decision stream for Agent #{CONFIG.agent.agentId}.
          </p>
        </div>

        <button
          onClick={handleRunAgentOnce}
          disabled={isRunning || !session?.active}
          className="bg-primary text-on-primary text-xs font-medium px-6 py-3 rounded-full hover:opacity-90 active:scale-95 transition-all inline-flex items-center space-x-2 shrink-0 disabled:opacity-50 shadow-sm"
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>Run Agent Once</span>
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric 1: Session & Countdown */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">Session Status</span>
            <div className="flex items-center space-x-1">
              {session?.active ? (
                <span className="inline-flex items-center space-x-1 text-[11px] font-semibold text-emerald-600 bg-success-container px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>ACTIVE</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 text-[11px] font-semibold text-outline bg-surface-container px-2 py-0.5 rounded-full">
                  <span>INACTIVE</span>
                </span>
              )}
            </div>
          </div>

          <div className="my-2">
            <div className="text-2xl font-semibold text-on-surface font-mono">
              {session?.active
                ? `${Math.floor(session.secondsRemaining / 3600)}h ${Math.floor((session.secondsRemaining % 3600) / 60)}m`
                : "0h 0m"}
            </div>
            <div className="text-xs text-outline mt-1">
              {session?.active ? "Until onchain policy expiration" : "Deploy a policy to activate session"}
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-surface-highest flex justify-between items-center text-xs">
            <span className="text-outline">Agent Identity:</span>
            <span className="font-mono text-on-surface">ERC-8004 #{CONFIG.agent.agentId}</span>
          </div>
        </div>

        {/* Metric 2: Spent Today / Rolling Window Progress */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">Rolling Daily Budget</span>
            <span className="text-xs font-mono text-on-surface-variant">
              {windowInfo?.formattedBudget ?? "0.00"} / 10.00 mWMON
            </span>
          </div>

          <div className="my-2">
            <div className="text-2xl font-semibold text-on-surface font-mono">
              {spentPercent.toFixed(0)}% <span className="text-xs font-sans text-outline">consumed</span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden mt-3">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${spentPercent}%` }}
              />
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-surface-highest flex justify-between items-center text-xs">
            <span className="text-outline">Reset Window:</span>
            <span className="font-mono text-on-surface">
              {windowInfo ? `${Number(windowInfo.secondsUntilReset)}s` : "Idle"}
            </span>
          </div>
        </div>

        {/* Metric 3: Vault Balances */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">Vault Balance</span>
            <Link to="/app/vault" className="text-xs text-primary hover:underline inline-flex items-center">
              <span>Deposit</span>
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="my-2 space-y-1">
            <div className="text-xl font-semibold text-on-surface font-mono">
              {formattedTokenA} <span className="text-xs font-sans text-outline">mWMON</span>
            </div>
            <div className="text-xl font-semibold text-on-surface font-mono">
              {formattedTokenB} <span className="text-xs font-sans text-outline">mUSDT</span>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-surface-highest flex justify-between items-center text-xs">
            <span className="text-outline">Protected by:</span>
            <span className="font-mono text-emerald-600">Non-Custodial Vault</span>
          </div>
        </div>
      </div>

      {/* Execution Feedback Banner */}
      {lastExecution && (
        <div
          className={`p-4 rounded-card border text-xs leading-relaxed ${
            lastExecution.status === "success"
              ? "bg-success-container border-success-border text-success"
              : "bg-surface-container border-outline-variant text-on-surface"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold uppercase tracking-wider">
              Last Execution Result: {lastExecution.status}
            </span>
            {lastExecution.tx_hash && (
              <a
                href={getExplorerTxUrl(lastExecution.tx_hash)}
                target="_blank"
                rel="noreferrer"
                className="underline font-mono inline-flex items-center space-x-1"
              >
                <span>View Tx on MonadScan</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="text-on-surface-variant font-mono">
            {lastExecution.details ||
              `Spent: ${lastExecution.spent ? lastExecution.spent / 10 ** 18 : 0} mWMON · Received: ${
                lastExecution.received ? lastExecution.received / 10 ** 18 : 0
              } mUSDT`}
          </div>
        </div>
      )}

      {/* Live Decision Stream Panel */}
      <div className="bg-surface-dark rounded-card p-6 border border-gray-800 text-gray-200 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-gray-800 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-semibold tracking-wide text-white uppercase">
              Live WebSocket Decision Stream (/agent/stream)
            </span>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono">
            {wsConnected ? (
              <span className="inline-flex items-center space-x-1 text-emerald-400">
                <Wifi className="w-3.5 h-3.5" />
                <span>STREAM ONLINE</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1 text-amber-400">
                <WifiOff className="w-3.5 h-3.5" />
                <span>CONNECTING...</span>
              </span>
            )}
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500 font-mono text-xs">
            Waiting for agent decisions... Click &ldquo;Run Agent Once&rdquo; above to dispatch a live trade cycle.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, idx) => (
              <div key={idx} className="p-4 rounded-panel bg-surface-darkcard border border-gray-800 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between text-gray-400 pb-2 border-b border-gray-800/60">
                  <span className="text-accent-monad uppercase font-semibold">[{m.type}]</span>
                  <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>

                {m.signals && (
                  <div className="text-gray-300">
                    <span className="text-gray-500">[MARKET SIGNALS - MOCK]: </span>
                    <span>Pair: mWMON/mUSDT · Price: ${m.signals.price} · RSI: {m.signals.rsi} · Source: {m.signals.source}</span>
                  </div>
                )}

                {m.decision && (
                  <div className="text-white">
                    <span className="text-gray-500">[DECISION]: </span>
                    <span className="font-semibold text-emerald-400">{m.decision.action}</span>
                    <span> · Amount: {m.decision.amount_in / 10 ** 18} mWMON · Rationale: &ldquo;{m.decision.rationale}&rdquo;</span>
                  </div>
                )}

                {m.result && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-[11px] text-gray-400 pt-1 gap-1">
                    <div>
                      <span>Status: </span>
                      <strong className={m.result.status === "success" ? "text-emerald-400" : "text-amber-400"}>
                        {m.result.status}
                      </strong>
                      {m.result.reason_name && <span className="text-red-400"> ({m.result.reason_name})</span>}
                    </div>
                    {m.result.tx_hash && (
                      <a
                        href={getExplorerTxUrl(m.result.tx_hash)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-on hover:underline text-gray-300 inline-flex items-center space-x-1"
                      >
                        <span>Tx: {m.result.tx_hash.slice(0, 12)}...</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
