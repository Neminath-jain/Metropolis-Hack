import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { safeStorage, type ActiveSessionAccount, type StoredPasskey } from "../services/storage";
import { aegisClient } from "../services/aegis";
import { CONFIG } from "../config";

export interface SessionInfo {
  active: boolean;
  expiresAt: bigint;
  agentId: bigint;
  isExpired: boolean;
  secondsRemaining: number;
}

export interface WindowRemainingInfo {
  remainingBudget: bigint;
  secondsUntilReset: bigint;
  formattedBudget: string;
}

export interface AegisContextType {
  account: ActiveSessionAccount | null;
  storedPasskeys: StoredPasskey[];
  setAccount: (account: ActiveSessionAccount | null) => void;
  disconnect: () => void;
  refreshPasskeys: () => void;

  // Vault Balances
  tokenABalance: bigint;
  tokenBBalance: bigint;
  formattedTokenA: string;
  formattedTokenB: string;
  isBalancesLoading: boolean;
  refreshBalances: () => Promise<void>;

  // Session & Policy Status
  session: SessionInfo | null;
  windowInfo: WindowRemainingInfo | null;
  isSessionLoading: boolean;
  refreshSession: () => Promise<void>;

  // Combined Refresh
  refreshAll: () => Promise<void>;
}

const AegisContext = createContext<AegisContextType | null>(null);

export const AegisProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [account, setAccountState] = useState<ActiveSessionAccount | null>(() => safeStorage.getActiveAccount());
  const [storedPasskeys, setStoredPasskeys] = useState<StoredPasskey[]>(() => safeStorage.getStoredPasskeys());

  const [tokenABalance, setTokenABalance] = useState<bigint>(0n);
  const [tokenBBalance, setTokenBBalance] = useState<bigint>(0n);
  const [isBalancesLoading, setIsBalancesLoading] = useState<boolean>(false);

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [windowInfo, setWindowInfo] = useState<WindowRemainingInfo | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(false);

  const setAccount = useCallback((acc: ActiveSessionAccount | null) => {
    safeStorage.setActiveAccount(acc);
    setAccountState(acc);
  }, []);

  const disconnect = useCallback(() => {
    safeStorage.setActiveAccount(null);
    setAccountState(null);
    setSession(null);
    setWindowInfo(null);
    setTokenABalance(0n);
    setTokenBBalance(0n);
  }, []);

  const refreshPasskeys = useCallback(() => {
    setStoredPasskeys(safeStorage.getStoredPasskeys());
  }, []);

  // Fetch vault balances for active account
  const refreshBalances = useCallback(async () => {
    if (!account?.address) return;
    try {
      setIsBalancesLoading(true);
      const [balA, balB] = await Promise.all([
        aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenA).catch(() => 0n),
        aegisClient.balanceOf(account.address, CONFIG.contracts.tokens.tokenB).catch(() => 0n),
      ]);
      setTokenABalance(balA);
      setTokenBBalance(balB);
    } catch (err) {
      console.warn("Failed to fetch vault balances:", err);
    } finally {
      setIsBalancesLoading(false);
    }
  }, [account?.address]);

  // Fetch active session and windowRemaining
  const refreshSession = useCallback(async () => {
    if (!account?.address) return;
    try {
      setIsSessionLoading(true);
      const agentAddr = CONFIG.agent.address as Address;
      const sess = await aegisClient.getSession(account.address, agentAddr).catch(() => null);

      if (sess && sess.active) {
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const isExp = sess.expiresAt <= nowSec;
        const remaining = Number(sess.expiresAt > nowSec ? sess.expiresAt - nowSec : 0n);

        setSession({
          active: sess.active && !isExp,
          expiresAt: sess.expiresAt,
          agentId: sess.agentId,
          isExpired: isExp,
          secondsRemaining: remaining,
        });

        const win = await aegisClient
          .windowRemaining(account.address, agentAddr, CONFIG.contracts.tokens.tokenA)
          .catch(() => null);

        if (win) {
          setWindowInfo({
            remainingBudget: win.remainingBudget,
            secondsUntilReset: win.secondsUntilReset,
            formattedBudget: Number(formatUnits(win.remainingBudget, 18)).toFixed(2),
          });
        }
      } else {
        setSession(null);
        setWindowInfo(null);
      }
    } catch (err) {
      console.warn("Failed to fetch session:", err);
    } finally {
      setIsSessionLoading(false);
    }
  }, [account?.address]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshBalances(), refreshSession()]);
  }, [refreshBalances, refreshSession]);

  useEffect(() => {
    if (account?.address) {
      refreshAll();
    }
  }, [account?.address, refreshAll]);

  // Periodic polling every 12 seconds
  useEffect(() => {
    if (!account?.address) return;
    const interval = setInterval(refreshAll, 12000);
    return () => clearInterval(interval);
  }, [account?.address, refreshAll]);

  const formattedTokenA = Number(formatUnits(tokenABalance, 18)).toFixed(2);
  const formattedTokenB = Number(formatUnits(tokenBBalance, 18)).toFixed(2);

  return (
    <AegisContext.Provider
      value={{
        account,
        storedPasskeys,
        setAccount,
        disconnect,
        refreshPasskeys,
        tokenABalance,
        tokenBBalance,
        formattedTokenA,
        formattedTokenB,
        isBalancesLoading,
        refreshBalances,
        session,
        windowInfo,
        isSessionLoading,
        refreshSession,
        refreshAll,
      }}
    >
      {children}
    </AegisContext.Provider>
  );
};

export function useAegis(): AegisContextType {
  const context = useContext(AegisContext);
  if (!context) {
    throw new Error("useAegis must be used within an AegisProvider");
  }
  return context;
}
