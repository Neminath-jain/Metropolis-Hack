import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Coins, ArrowDownLeft, ArrowUpRight, Gift, Loader2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { parseEther, type Address } from "viem";
import { useAegis } from "../context/AegisContext";
import { claimFaucetTokens, withdrawWithPasskeyViaRelay } from "../services/aegis";
import { CONFIG } from "../config";


export const VaultView: React.FC = () => {
  const { account, tokenABalance, tokenBBalance, formattedTokenA, formattedTokenB, refreshBalances } = useAegis();

  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState<string | null>(null);
  const [faucetError, setFaucetError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"faucet" | "withdraw">("faucet");

  // Withdraw state
  const [withdrawToken, setWithdrawToken] = useState<string>(CONFIG.contracts.tokens.tokenA);
  const [withdrawAmount, setWithdrawAmount] = useState<string>("1.0");
  const [withdrawTo, setWithdrawTo] = useState<string>("");
  const [isWithdrawLoading, setIsWithdrawLoading] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleClaimFaucet = async () => {
    if (!account?.address) return;
    try {
      setIsFaucetLoading(true);
      setFaucetError(null);
      setFaucetSuccess(null);

      const res = await claimFaucetTokens(account.address);
      setFaucetSuccess(`Successfully credited 10.00 mWMON to your vault! Tx: ${res.tx_hash}`);
      await refreshBalances();
    } catch (err: unknown) {
      console.error("Faucet error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setFaucetError(msg);
    } finally {
      setIsFaucetLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account?.address) return;

    try {
      setIsWithdrawLoading(true);
      setWithdrawError(null);
      setWithdrawSuccess(null);

      const parsedAmount = parseEther(withdrawAmount || "0");
      if (parsedAmount <= 0n) throw new Error("Please enter a valid amount greater than 0");

      const recipient = (withdrawTo.trim() || account.address) as Address;

      if (account.type === "passkey") {
        // Passkey withdrawal via WebAuthn biometric assertion relayed onchain
        const relayRes = await withdrawWithPasskeyViaRelay({
          userId: account.address,
          token: withdrawToken as Address,
          amount: parsedAmount,
          to: recipient,
        });
        setWithdrawSuccess(`Passkey withdrawal submitted! Tx: ${relayRes.tx_hash}`);
      } else {
        throw new Error("EOA direct withdrawal requires an active wallet client signer.");
      }

      await refreshBalances();
    } catch (err: unknown) {
      console.error("Withdraw error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setWithdrawError(msg);
    } finally {
      setIsWithdrawLoading(false);
    }
  };

  if (!account) {
    return (
      <div className="max-w-[640px] mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-outline mx-auto mb-4">
          <Coins className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-on-surface mb-2">Connect Your Account</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Connect a passkey or wallet to view your smart vault balances and claim test tokens.
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
          <h1 className="text-2xl sm:text-3xl font-semibold text-on-surface">AgentGuard Smart Vault</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Non-custodial token balances managed by your onchain account ({account.address.slice(0, 8)}...{account.address.slice(-6)}).
          </p>
        </div>

        <button
          onClick={handleClaimFaucet}
          disabled={isFaucetLoading}
          className="bg-primary text-on-primary text-xs font-medium px-5 py-2.5 rounded-full hover:opacity-90 active:scale-95 transition-all inline-flex items-center space-x-2 shrink-0 disabled:opacity-50"
        >
          {isFaucetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
          <span>Get Test Tokens (Faucet)</span>
        </button>
      </div>

      {/* Mock Asset Notice */}
      <div className="p-4 rounded-panel bg-surface-container border border-outline-variant text-xs text-on-surface-variant mb-8 flex items-start space-x-3">
        <Coins className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div>
          <strong className="text-on-surface">Testnet Mock Assets:</strong>
          {" "}All tokens (<code className="font-mono">mWMON</code>, <code className="font-mono">mUSDT</code>) and the DEX venue
          are testnet-only mock implementations deployed on Monad testnet. They carry no real financial value.
        </div>
      </div>

      {/* Balance Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        {/* Token A Card */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-outline">Token A (Base)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant">
                ERC-20 Mock
              </span>
            </div>
            <div className="text-3xl font-semibold text-on-surface font-mono mb-1">
              {formattedTokenA} <span className="text-lg font-sans text-outline">mWMON</span>
            </div>
            <div className="text-xs text-outline font-mono">
              Raw: {tokenABalance.toString()} wei
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-surface-highest flex justify-between items-center text-xs">
            <span className="text-outline">Contract:</span>
            <a
              href={`${CONFIG.explorerBaseUrl}/address/${CONFIG.contracts.tokens.tokenA}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-primary hover:underline inline-flex items-center space-x-1"
            >
              <span>{CONFIG.contracts.tokens.tokenA.slice(0, 6)}...{CONFIG.contracts.tokens.tokenA.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-outline" />
            </a>
          </div>
        </div>

        {/* Token B Card */}
        <div className="bg-surface-bright border border-outline-variant rounded-card p-6 card-elevation flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-outline">Token B (Quote)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant">
                ERC-20 Mock
              </span>
            </div>
            <div className="text-3xl font-semibold text-on-surface font-mono mb-1">
              {formattedTokenB} <span className="text-lg font-sans text-outline">mUSDT</span>
            </div>
            <div className="text-xs text-outline font-mono">
              Raw: {tokenBBalance.toString()} wei
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-surface-highest flex justify-between items-center text-xs">
            <span className="text-outline">Contract:</span>
            <a
              href={`${CONFIG.explorerBaseUrl}/address/${CONFIG.contracts.tokens.tokenB}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-primary hover:underline inline-flex items-center space-x-1"
            >
              <span>{CONFIG.contracts.tokens.tokenB.slice(0, 6)}...{CONFIG.contracts.tokens.tokenB.slice(-4)}</span>
              <ExternalLink className="w-3 h-3 text-outline" />
            </a>
          </div>
        </div>
      </div>

      {/* Faucet Alert Feedbacks */}
      {faucetSuccess && (
        <div className="p-4 rounded-panel bg-success-container border border-success-border text-xs text-success mb-6 flex items-start space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-all">{faucetSuccess}</span>
        </div>
      )}
      {faucetError && (
        <div className="p-4 rounded-panel bg-error-container border border-error-border text-xs text-error mb-6 flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-all">{faucetError}</span>
        </div>
      )}

      {/* Vault Actions Card */}
      <div className="bg-surface-bright border border-outline-variant rounded-card p-8 card-elevation">
        <div className="flex p-1 bg-surface-container rounded-full mb-8 max-w-xs">
          <button
            onClick={() => setActiveTab("faucet")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-full transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === "faucet" ? "bg-primary text-on-primary shadow-sm" : "text-outline hover:text-on-surface"
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Fund / Faucet</span>
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-full transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === "withdraw" ? "bg-primary text-on-primary shadow-sm" : "text-outline hover:text-on-surface"
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Withdraw</span>
          </button>
        </div>

        {activeTab === "faucet" && (
          <div className="space-y-4">
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Mint mock testnet tokens directly into your vault via <code className="font-mono text-primary font-semibold">depositFor()</code>.
              The transaction gas is sponsored by the testnet relayer.
            </p>
            <button
              onClick={handleClaimFaucet}
              disabled={isFaucetLoading}
              className="bg-primary text-on-primary font-medium text-xs py-3 px-6 rounded-full hover:opacity-90 active:scale-95 transition-all flex items-center space-x-2 disabled:opacity-50"
            >
              {isFaucetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              <span>Claim 10.00 mWMON</span>
            </button>
          </div>
        )}

        {activeTab === "withdraw" && (
          <form onSubmit={handleWithdraw} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-on-surface mb-1">Select Token</label>
                <select
                  value={withdrawToken}
                  onChange={(e) => setWithdrawToken(e.target.value)}
                  className="w-full bg-surface border border-outline-variant rounded-control px-3 py-2 text-xs font-mono"
                >
                  <option value={CONFIG.contracts.tokens.tokenA}>mWMON ({CONFIG.contracts.tokens.tokenA.slice(0, 8)}...)</option>
                  <option value={CONFIG.contracts.tokens.tokenB}>mUSDT ({CONFIG.contracts.tokens.tokenB.slice(0, 8)}...)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface mb-1">Amount</label>
                <input
                  type="text"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="1.0"
                  className="w-full bg-surface border border-outline-variant rounded-control px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface mb-1">Recipient Address (leave blank for self)</label>
              <input
                type="text"
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value)}
                placeholder={account.address}
                className="w-full bg-surface border border-outline-variant rounded-control px-3 py-2 text-xs font-mono"
              />
            </div>

            {withdrawSuccess && (
              <div className="p-3 rounded-panel bg-success-container border border-success-border text-xs text-success flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">{withdrawSuccess}</span>
              </div>
            )}
            {withdrawError && (
              <div className="p-3 rounded-panel bg-error-container border border-error-border text-xs text-error flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">{withdrawError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isWithdrawLoading}
              className="bg-primary text-on-primary font-medium text-xs py-3 px-6 rounded-full hover:opacity-90 active:scale-95 transition-all flex items-center space-x-2 disabled:opacity-50"
            >
              {isWithdrawLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
              <span>Authorize Withdrawal ({account.type === "passkey" ? "Passkey Biometric" : "Wallet"})</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
