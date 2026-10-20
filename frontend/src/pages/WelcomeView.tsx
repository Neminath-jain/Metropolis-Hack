import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Key, Wallet, ShieldCheck, ArrowRight, Loader2, Info, CheckCircle2, AlertCircle } from "lucide-react";
import { createPasskey } from "@aegis-monad/sdk";
import { toHex } from "viem";
import { useAegis } from "../context/AegisContext";
import { registerPasskeyOnchain, type RelayResult } from "../services/aegis";
import { safeStorage } from "../services/storage";
import { getExplorerAddressUrl } from "../config";

export const WelcomeView: React.FC = () => {
  const navigate = useNavigate();
  const { account, storedPasskeys, setAccount, refreshPasskeys } = useAegis();

  const [activeTab, setActiveTab] = useState<"passkey" | "wallet">("passkey");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<RelayResult | null>(null);

  // 1. Create and Register New Passkey via WebAuthn and /relay
  const handleCreatePasskey = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      setSuccessResult(null);

      // Check browser WebAuthn support
      if (typeof window === "undefined" || !window.PublicKeyCredential) {
        throw new Error("WebAuthn API is not supported in this browser environment.");
      }

      const passkeyName = `aegis-user-${Math.floor(Date.now() / 1000)}`;
      const pk = await createPasskey({
        userName: passkeyName,
        userDisplayName: "Aegis Vault User",
      });


      // Submit public key registration to Monad testnet via backend relayer
      const relayRes = await registerPasskeyOnchain(pk.qx, pk.qy);
      setSuccessResult(relayRes);

      // Save passkey in local storage
      const passkeyData = {
        credentialId: pk.credentialId,
        rawId: pk.rawId,
        userId: pk.userId,
        qx: toHex(pk.qx),
        qy: toHex(pk.qy),
        createdAt: Date.now(),
      };
      safeStorage.savePasskey(passkeyData);
      refreshPasskeys();

      // Set as active account
      setAccount({
        type: "passkey",
        address: pk.userId,
        credentialId: pk.credentialId,
        rawId: pk.rawId,
        qx: toHex(pk.qx),
        qy: toHex(pk.qy),
      });
    } catch (err: unknown) {
      console.error("Passkey creation failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Sign In with Stored Passkey
  const handleSelectStoredPasskey = (p: typeof storedPasskeys[0]) => {
    setAccount({
      type: "passkey",
      address: p.userId as `0x${string}`,
      credentialId: p.credentialId,
      rawId: p.rawId,
      qx: p.qx,
      qy: p.qy,
    });
    navigate("/app/vault");
  };

  // 3. Connect Wallet (EOA Fallback)
  const handleConnectWallet = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);

      const anyWindow = window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } };
      if (!anyWindow.ethereum) {
        throw new Error("No browser wallet extension (such as MetaMask or Rabby) detected.");
      }

      const accounts = await anyWindow.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts authorized by user in browser wallet.");
      }

      const address = accounts[0] as `0x${string}`;
      setAccount({
        type: "wallet",
        address,
      });
      navigate("/app/vault");
    } catch (err: unknown) {
      console.error("Wallet connection failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-[760px] mx-auto py-8">
      {/* Page Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-on-surface mb-2">Welcome to Aegis-Monad</h1>
        <p className="text-sm text-on-surface-variant max-w-[500px] mx-auto">
          Choose an identity path to manage your non-custodial delegation vault on Monad testnet.
        </p>
      </div>

      {/* Identity Selector Card */}
      <div className="bg-surface-bright border border-outline-variant rounded-card p-8 card-elevation mb-8">
        {/* Tab Toggle */}
        <div className="flex p-1 bg-surface-container rounded-full mb-8 max-w-sm mx-auto">
          <button
            onClick={() => setActiveTab("passkey")}
            className={`flex-1 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center space-x-2 ${
              activeTab === "passkey" ? "bg-primary text-on-primary shadow-sm" : "text-outline hover:text-on-surface"
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Passkey (Default)</span>
          </button>
          <button
            onClick={() => setActiveTab("wallet")}
            className={`flex-1 py-2 text-xs font-medium rounded-full transition-all flex items-center justify-center space-x-2 ${
              activeTab === "wallet" ? "bg-primary text-on-primary shadow-sm" : "text-outline hover:text-on-surface"
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Browser Wallet (EOA)</span>
          </button>
        </div>

        {/* Tab 1: Passkey Option */}
        {activeTab === "passkey" && (
          <div className="space-y-6">
            <div className="p-4 rounded-panel bg-surface-container border border-outline-variant text-xs text-on-surface-variant leading-relaxed">
              <div className="flex items-start space-x-2">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <strong className="text-on-surface">Zero-Gas Biometric Onboarding:</strong>
                  {" "}Your P-256 public key is registered on Monad testnet sponsored by the testnet relayer.
                  Your biometric keypair never leaves your hardware enclave.
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-4 rounded-panel bg-error-container border border-error-border text-xs text-error flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}

            {successResult && (
              <div className="p-4 rounded-panel bg-success-container border border-success-border text-xs text-success space-y-2">
                <div className="flex items-center space-x-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Passkey Registered Onchain!</span>
                </div>
                <div className="text-[11px] text-on-surface-variant font-mono">
                  Account ID: <a href={getExplorerAddressUrl(account?.address || "")} target="_blank" rel="noreferrer" className="underline">{account?.address}</a>
                </div>
                <div className="text-[11px] text-on-surface-variant font-mono">
                  Tx Hash: <a href={successResult.explorer_url} target="_blank" rel="noreferrer" className="underline">{successResult.tx_hash}</a>
                </div>
              </div>
            )}

            {/* Main Action Button */}
            <button
              onClick={handleCreatePasskey}
              disabled={isLoading}
              className="w-full bg-primary text-on-primary font-medium text-sm py-3.5 px-6 rounded-full hover:opacity-90 active:scale-95 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Prompting Authenticator & Relaying...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Create Passkey with Biometrics</span>
                </>
              )}
            </button>

            {/* Stored Passkeys in this Browser */}
            {storedPasskeys.length > 0 && (
              <div className="pt-6 border-t border-surface-highest">
                <div className="text-xs font-semibold text-outline uppercase tracking-wider mb-3">
                  Or Sign In with Stored Passkey
                </div>
                <div className="space-y-2">
                  {storedPasskeys.map((p) => (
                    <div
                      key={p.credentialId}
                      onClick={() => handleSelectStoredPasskey(p)}
                      className="p-3 rounded-panel bg-surface hover:bg-surface-container border border-outline-variant cursor-pointer transition-colors flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center space-x-3">
                        <Key className="w-4 h-4 text-outline" />
                        <div>
                          <div className="font-mono font-semibold text-on-surface">
                            {p.userId.slice(0, 10)}...{p.userId.slice(-6)}
                          </div>
                          <div className="text-[11px] text-outline">
                            Created {new Date(p.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <span className="text-primary font-medium inline-flex items-center space-x-1">
                        <span>Select</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Wallet Option */}
        {activeTab === "wallet" && (
          <div className="space-y-6">
            <div className="p-4 rounded-panel bg-surface-container border border-outline-variant text-xs text-on-surface-variant leading-relaxed">
              <div className="flex items-start space-x-2">
                <Wallet className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <strong className="text-on-surface">Standard EOA Connection:</strong>
                  {" "}Connect your existing MetaMask, Rabby, or browser Web3 wallet. You will sign transactions
                  directly from your wallet extension to configure vaults and policies.
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-4 rounded-panel bg-error-container border border-error-border text-xs text-error flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}

            <button
              onClick={handleConnectWallet}
              disabled={isLoading}
              className="w-full bg-primary text-on-primary font-medium text-sm py-3.5 px-6 rounded-full hover:opacity-90 active:scale-95 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting Wallet...</span>
                </>
              ) : (
                <>
                  <Wallet className="w-4 h-4" />
                  <span>Connect Browser Wallet</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Educational Explanation Box */}
      <div className="p-6 rounded-card bg-surface-container border border-outline-variant text-xs text-on-surface-variant leading-relaxed space-y-3">
        <div className="flex items-center space-x-2 text-on-surface font-semibold text-sm">
          <Info className="w-4 h-4 text-primary" />
          <span>What is a Passkey and why is there no seed phrase?</span>
        </div>
        <p>
          Passkeys replace insecure passwords and seed phrases with modern public-key cryptography (FIDO2 / WebAuthn).
          When you register, your device’s hardware security chip (Apple Secure Enclave, Android Titan, Windows Hello, or YubiKey)
          generates a unique SECP256R1 (P-256) keypair.
        </p>
        <p>
          Your private key NEVER leaves your physical device and cannot be extracted, phished, or copied.
          Monad natively verifies P-256 signatures onchain at precompile address <code className="font-mono font-bold text-primary">0x0100</code> (RIP-7212).
          You never need to memorize or back up a 12-word seed phrase.
        </p>
        <p className="text-[11px] text-outline pt-2 border-t border-outline-variant/60">
          Note: The Mera deterministic passkey derivation helper is marked experimental/untested and omitted from active production options per specification.
        </p>
      </div>
    </div>
  );
};
