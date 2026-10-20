import React from "react";
import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";
import { StatusBanner } from "./StatusBanner";

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-surface flex flex-col font-sans text-on-surface">
      <Navbar />
      <StatusBanner />
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-surface-highest bg-surface-bright py-6 px-6 text-center text-xs text-outline">
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Aegis-Monad · Non-custodial AI Agent Policy Engine on Monad Testnet</span>
          <span className="text-[11px] font-mono">Chain ID: 10143 · Testnet Demo (Unaudited)</span>
        </div>
      </footer>
    </div>
  );
};
