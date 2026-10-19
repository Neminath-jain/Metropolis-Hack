import { Shield, Cpu, Key, Activity, CheckCircle2, Lock } from "lucide-react";

export default function App() {
  const chainId = 10143;
  const networkName = "Monad Testnet";

  return (
    <div className="min-h-screen bg-[#0a0b10] text-gray-100 flex flex-col font-sans selection:bg-purple-500/30">
      {/* Top Navigation */}
      <header className="border-b border-gray-800/80 bg-[#0e1017]/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400">
                Aegis
              </span>
              <span className="ml-2 text-xs font-mono uppercase px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/50">
                Protocol
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[#141622] border border-gray-800 text-xs font-mono">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-gray-300">{networkName}</span>
              <span className="text-gray-500">|</span>
              <span className="text-purple-400 font-semibold">Chain ID {chainId}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-900/30 border border-purple-700/40 text-purple-300 text-xs mb-6">
            <Lock className="w-3.5 h-3.5" />
            <span>Open Delegation Primitive for Autonomous AI Agents</span>
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white via-gray-100 to-gray-400">
            Aegis-Monad
          </h1>

          <p className="text-lg text-gray-400 leading-relaxed">
            Non-custodial smart vaults with onchain passkey delegation (P256/WebAuthn) and ERC-8004 agent registries on Monad.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto w-full">
          <div className="p-6 rounded-2xl bg-[#12141e]/80 border border-gray-800/80 hover:border-purple-600/50 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl bg-purple-950/50 border border-purple-800/30 flex items-center justify-center mb-4 text-purple-400 group-hover:scale-105 transition-transform">
              <Key className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Passkey Security</h3>
            <p className="text-sm text-gray-400">
              Users authorize agent policies with biometrics via native P256 precompiles (EIP-7951 / 0x0100).
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#12141e]/80 border border-gray-800/80 hover:border-purple-600/50 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl bg-indigo-950/50 border border-indigo-800/30 flex items-center justify-center mb-4 text-indigo-400 group-hover:scale-105 transition-transform">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Autonomous Agents</h3>
            <p className="text-sm text-gray-400">
              AI trading agents identified via ERC-8004 operate inside bounded daily and per-trade token limits.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#12141e]/80 border border-gray-800/80 hover:border-purple-600/50 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center mb-4 text-emerald-400 group-hover:scale-105 transition-transform">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Non-Custodial</h3>
            <p className="text-sm text-gray-400">
              Users retain full withdrawal and immediate revocation rights at any time, even if paused.
            </p>
          </div>
        </div>

        {/* Status Banner */}
        <div className="mt-12 max-w-xl mx-auto w-full p-4 rounded-xl bg-[#131520] border border-gray-800 flex items-center justify-between text-xs text-gray-400 font-mono">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Monad Testnet Connected</span>
          </div>
          <span className="text-purple-400">Chain ID: {chainId}</span>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/60 py-6 text-center text-xs text-gray-500 font-mono">
        Monad Metropolis Hackathon · Trust, Identity & AI Infrastructure Track
      </footer>
    </div>
  );
}
