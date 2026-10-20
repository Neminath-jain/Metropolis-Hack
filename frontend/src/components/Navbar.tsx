import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Shield, ExternalLink, ArrowRight } from "lucide-react";
import { useAegis } from "../context/AegisContext";
import { getExplorerAddressUrl } from "../config";



export const Navbar: React.FC = () => {
  const location = useLocation();
  const { account, disconnect } = useAegis();
  const isApp = location.pathname.startsWith("/app");

  const formatAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-surface-highest bg-surface/80 backdrop-blur-xl transition-all">
      <div className="max-w-[1280px] mx-auto px-6 h-20 flex justify-between items-center">
        {/* Brand / Wordmark */}
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-on-primary group-hover:scale-105 transition-transform">
            <Shield className="w-5 h-5 text-on-primary" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-xl tracking-tight text-on-surface">Aegis</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant">
                Monad
              </span>
            </div>
            <span className="text-[11px] text-outline tracking-tight">Autonomous AI Delegation</span>
          </div>
        </Link>

        {/* Navigation Links (Landing Mode) */}
        {!isApp ? (
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium">
            <a href="#how-it-works" className="text-outline hover:text-on-surface transition-colors">
              How it Works
            </a>
            <a href="#developers" className="text-outline hover:text-on-surface transition-colors">
              Developers
            </a>
            <a href="#security" className="text-outline hover:text-on-surface transition-colors">
              Security
            </a>
            <a href="#deployments" className="text-outline hover:text-on-surface transition-colors">
              Live Deployments
            </a>
          </nav>
        ) : (
          <nav className="hidden md:flex items-center space-x-2 text-xs font-medium">
            <Link
              to="/app"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app" || location.pathname === "/app/welcome"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              Identity
            </Link>
            <Link
              to="/app/vault"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app/vault"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              Vault
            </Link>
            <Link
              to="/app/policy"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app/policy"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              Policy Builder
            </Link>
            <Link
              to="/app/dashboard"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app/dashboard"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              Dashboard
            </Link>
            <Link
              to="/app/red-team"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app/red-team"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              Red-Team
            </Link>
            <Link
              to="/app/history"
              className={`px-3 py-1.5 rounded-full transition-all ${
                location.pathname === "/app/history"
                  ? "bg-primary text-on-primary"
                  : "text-outline hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              History
            </Link>
          </nav>
        )}

        {/* Right CTA / Account Status */}
        <div className="flex items-center space-x-4">
          {/* Network Pill */}
          <div className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-surface-container border border-outline-variant text-xs font-mono text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Monad Testnet</span>
          </div>

          {account ? (
            <div className="flex items-center space-x-2">
              <a
                href={getExplorerAddressUrl(account.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-surface-bright border border-outline-variant hover:border-primary text-xs font-mono transition-all"
                title="View Account on MonadScan"
              >
                <span className="font-semibold text-primary">{formatAddr(account.address)}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-surface-container text-outline uppercase font-sans">
                  {account.type}
                </span>
                <ExternalLink className="w-3 h-3 text-outline" />
              </a>

              {isApp && (
                <button
                  onClick={disconnect}
                  className="text-xs text-outline hover:text-error hover:underline px-2 py-1"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : !isApp ? (
            <Link
              to="/app"
              className="bg-primary text-on-primary font-medium text-sm px-6 py-2.5 rounded-full hover:opacity-90 active:scale-95 transition-all inline-flex items-center space-x-2"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              to="/app/welcome"
              className="bg-primary text-on-primary font-medium text-xs px-4 py-2 rounded-full hover:opacity-90 transition-all"
            >
              Connect
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
