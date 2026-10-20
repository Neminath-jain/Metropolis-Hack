import { useState, useEffect, useCallback } from "react";
import { History, RefreshCw, ExternalLink, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { formatUnits } from "viem";
import { useAegis } from "../context/AegisContext";
import { eventSource, type AegisHistoryEvent } from "../services/events";
import { getExplorerTxUrl } from "../config";


export const HistoryView: React.FC = () => {
  const { account } = useAegis();

  const [events, setEvents] = useState<AegisHistoryEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "ActionExecuted" | "PolicyViolation">("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const logs = await eventSource.getEvents(account?.address);
      setEvents(logs);
    } catch (err) {
      console.warn("Failed to load events:", err);
    } finally {
      setIsLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const filteredEvents = events.filter((ev: AegisHistoryEvent) => {
    if (filter === "all") return true;
    return ev.type === filter;
  });

  return (
    <div className="max-w-[1040px] mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-on-surface">Onchain Event Audit Log</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Historical ActionExecuted and PolicyViolation logs queried directly via viem getLogs (Envio Indexer Ready).
          </p>
        </div>

        <button
          onClick={loadEvents}
          disabled={isLoading}
          className="bg-surface hover:bg-surface-container border border-outline-variant text-on-surface text-xs font-medium px-4 py-2 rounded-full active:scale-95 transition-all inline-flex items-center space-x-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh Events</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex p-1 bg-surface-container rounded-full max-w-sm text-xs">
        <button
          onClick={() => setFilter("all")}
          className={`flex-1 py-1.5 rounded-full transition-all ${
            filter === "all" ? "bg-primary text-on-primary font-medium" : "text-outline hover:text-on-surface"
          }`}
        >
          All ({events.length})
        </button>
        <button
          onClick={() => setFilter("ActionExecuted")}
          className={`flex-1 py-1.5 rounded-full transition-all ${
            filter === "ActionExecuted" ? "bg-primary text-on-primary font-medium" : "text-outline hover:text-on-surface"
          }`}
        >
          Trades ({events.filter((e: AegisHistoryEvent) => e.type === "ActionExecuted").length})
        </button>
        <button
          onClick={() => setFilter("PolicyViolation")}
          className={`flex-1 py-1.5 rounded-full transition-all ${
            filter === "PolicyViolation" ? "bg-primary text-on-primary font-medium" : "text-outline hover:text-on-surface"
          }`}
        >
          Violations ({events.filter((e: AegisHistoryEvent) => e.type === "PolicyViolation").length})
        </button>
      </div>


      {/* Events List / Table */}
      <div className="bg-surface-bright border border-outline-variant rounded-card overflow-hidden card-elevation">
        {isLoading ? (
          <div className="py-20 text-center text-xs text-outline flex flex-col items-center justify-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span>Scanning Monad testnet blocks for event logs...</span>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-20 text-center text-xs text-outline space-y-2">
            <History className="w-8 h-8 mx-auto text-outline/50" />
            <div className="text-on-surface font-semibold text-sm">No Events Recorded Yet</div>
            <p className="text-on-surface-variant max-w-sm mx-auto">
              Run an agent trade cycle or trigger a red-team security test to generate live onchain logs.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-surface-container border-b border-surface-highest text-outline uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-6 py-3">Event Type</th>
                  <th className="px-6 py-3">Block</th>
                  <th className="px-6 py-3">Details / Amounts</th>
                  <th className="px-6 py-3">Decision Hash</th>
                  <th className="px-6 py-3 text-right">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-highest">
                {filteredEvents.map((ev: AegisHistoryEvent) => (
                  <tr key={ev.id} className="hover:bg-surface-container/50 transition-colors">

                    <td className="px-6 py-4 whitespace-nowrap">
                      {ev.type === "ActionExecuted" ? (
                        <span className="inline-flex items-center space-x-1.5 text-emerald-700 bg-success-container border border-success-border px-2.5 py-0.5 rounded-full text-[11px] font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>ActionExecuted</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1.5 text-error bg-error-container border border-error-border px-2.5 py-0.5 rounded-full text-[11px] font-semibold">
                          <AlertTriangle className="w-3 h-3 text-error" />
                          <span>Violation: {ev.reasonName}</span>
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-on-surface whitespace-nowrap">
                      #{ev.blockNumber.toString()}
                    </td>

                    <td className="px-6 py-4 text-on-surface-variant">
                      {ev.type === "ActionExecuted" ? (
                        <div>
                          <span>Spent: </span>
                          <strong className="text-on-surface">
                            {ev.spent ? Number(formatUnits(ev.spent, 18)).toFixed(2) : "0"} mWMON
                          </strong>
                          <span> · Received: </span>
                          <strong className="text-on-surface">
                            {ev.received ? Number(formatUnits(ev.received, 18)).toFixed(2) : "0"} mUSDT
                          </strong>
                        </div>
                      ) : (
                        <div className="text-error">
                          Reason Code {ev.reasonCode}: {ev.reasonName}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 text-outline break-all">
                      {ev.decisionHash.slice(0, 10)}...{ev.decisionHash.slice(-6)}
                    </td>

                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <a
                        href={getExplorerTxUrl(ev.transactionHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline inline-flex items-center space-x-1"
                      >
                        <span>{ev.transactionHash.slice(0, 8)}...</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
