import { DEPLOYED_ADDRESSES, VENUE_SELECTORS } from "@aegis-monad/sdk";

export const CONFIG = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID || 10143),
  networkName: import.meta.env.VITE_NETWORK_NAME || "Monad Testnet",
  rpcUrl: import.meta.env.VITE_RPC_URL || "https://testnet-rpc.monad.xyz",
  backendUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:8000",
  wsUrl: import.meta.env.VITE_WS_URL || "ws://localhost:8000",
  explorerBaseUrl: import.meta.env.VITE_EXPLORER_BASE_URL || "https://testnet.monadscan.com",

  // Contract Addresses from SDK Canonical Deployments
  contracts: {
    agentGuard: DEPLOYED_ADDRESSES.agentGuard,
    registry: DEPLOYED_ADDRESSES.registry,
    venue: DEPLOYED_ADDRESSES.venue,
    tokens: {
      tokenA: DEPLOYED_ADDRESSES.tokens.tokenA,
      tokenB: DEPLOYED_ADDRESSES.tokens.tokenB,
    },
    venueSelectors: {
      swap: VENUE_SELECTORS.swap,
    },
  },

  // Reference Agent Credentials
  agent: {
    address: DEPLOYED_ADDRESSES.agent.address,
    agentId: DEPLOYED_ADDRESSES.agent.agentId,
  },
} as const;

export function getExplorerTxUrl(txHash: string): string {
  const clean = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${CONFIG.explorerBaseUrl}/tx/${clean}`;
}

export function getExplorerAddressUrl(address: string): string {
  const clean = address.startsWith("0x") ? address : `0x${address}`;
  return `${CONFIG.explorerBaseUrl}/address/${clean}`;
}
