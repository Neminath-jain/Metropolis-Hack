import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert, AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { useAegis } from "../context/AegisContext";
import { CONFIG } from "../config";

export const StatusBanner: React.FC = () => {
  const { account, session, windowInfo } = useAegis();

  if (!account) {
    return (
      <div className="bg-surface-container border-b border-surface-highest px-6 py-3">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-outline" />
            <span>No account connected. Connect a WebAuthn Passkey or EOA Wallet to access delegation vaults.</span>
          </div>
          <Link
            to="/app/welcome"
            className="text-primary font-medium hover:underline inline-flex items-center space-x-1"
          >
            <span>Connect Identity</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (session && session.active && !session.isExpired) {
    const hours = Math.floor(session.secondsRemaining / 3600);
    const mins = Math.floor((session.secondsRemaining % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return (
      <div className="bg-success-container border-b border-success-border px-6 py-3 transition-colors">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs gap-2">
          <div className="flex items-center space-x-2 text-success">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span className="font-semibold">
              Agent #{CONFIG.agent.agentId} Bounded by Onchain Policy
            </span>
            <span className="text-on-surface-variant font-mono">
              (Rolling Daily Budget: {windowInfo?.formattedBudget ?? "..."} mWMON remaining)
            </span>
          </div>
          <div className="flex items-center space-x-4 text-on-surface-variant">
            <div className="flex items-center space-x-1 text-outline font-mono">
              <Clock className="w-3.5 h-3.5" />
              <span>Expires in {timeStr}</span>
            </div>
            <Link
              to="/app/policy"
              className="text-primary font-medium hover:underline inline-flex items-center space-x-1"
            >
              <span>Manage Policy</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (session && session.isExpired) {
    return (
      <div className="bg-error-container border-b border-error-border px-6 py-3">
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs text-error">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-semibold">Delegation Session Expired</span>
            <span className="text-on-surface-variant">
              Agent authority has automatically lapsed. Vault funds remain completely safe and non-custodial.
            </span>
          </div>
          <Link
            to="/app/policy"
            className="text-error font-medium hover:underline inline-flex items-center space-x-1"
          >
            <span>Renew Policy</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-container border-b border-surface-highest px-6 py-3">
      <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2 text-on-surface-variant">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="font-medium text-on-surface">No Active Delegation Session</span>
          <span className="text-outline">
            The reference agent currently has 0 spending allowance. Configure a bounded budget to authorize trading.
          </span>
        </div>
        <Link
          to="/app/policy"
          className="text-primary font-medium hover:underline inline-flex items-center space-x-1"
        >
          <span>Create Policy</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
};
