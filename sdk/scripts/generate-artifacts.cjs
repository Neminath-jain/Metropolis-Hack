const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../../');
const deploymentsPath = path.join(rootDir, 'contracts/deployments.json');
const artifactPath = path.join(rootDir, 'contracts/out/AgentGuard.sol/AgentGuard.json');
const mockDexArtifactPath = path.join(rootDir, 'contracts/out/MockDEX.sol/MockDEX.json');
const mockErc20ArtifactPath = path.join(rootDir, 'contracts/out/MockERC20.sol/MockERC20.json');
const outputDir = path.join(__dirname, '../src/contracts');

if (!fs.existsSync(deploymentsPath)) {
  console.error('deployments.json not found at:', deploymentsPath);
  process.exit(1);
}

if (!fs.existsSync(artifactPath)) {
  console.error('AgentGuard.json not found at:', artifactPath);
  process.exit(1);
}

const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
const agentGuardArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const mockDexArtifact = fs.existsSync(mockDexArtifactPath) 
  ? JSON.parse(fs.readFileSync(mockDexArtifactPath, 'utf8'))
  : { abi: [] };
const mockErc20Artifact = fs.existsSync(mockErc20ArtifactPath)
  ? JSON.parse(fs.readFileSync(mockErc20ArtifactPath, 'utf8'))
  : { abi: [] };

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const generatedTs = `// GENERATED AUTOMATICALLY FROM contracts/deployments.json and Foundry build artifacts
// DO NOT EDIT DIRECTLY. Run \`npm run codegen\` to regenerate.

import type { Address, Hex } from "viem";

export const MONAD_TESTNET_CHAIN_ID = ${deployments.chainId} as const;

export interface DeployedAddresses {
  readonly chainId: number;
  readonly network: string;
  readonly agentGuard: Address;
  readonly registry: Address;
  readonly venue: Address;
  readonly venueSelectors: {
    readonly swap: Hex;
  };
  readonly tokens: {
    readonly tokenA: Address;
    readonly tokenB: Address;
  };
  readonly agent: {
    readonly address: Address;
    readonly agentId: number;
    readonly registrationTx: string;
  };
  readonly verifiedExplorerUrl: string;
}

export const DEPLOYED_ADDRESSES: DeployedAddresses = {
  chainId: ${deployments.chainId},
  network: "${deployments.network}",
  agentGuard: "${deployments.contracts.agentGuard}",
  registry: "${deployments.contracts.registry}",
  venue: "${deployments.contracts.venue}",
  venueSelectors: {
    swap: "${deployments.contracts.venueSelectors ? deployments.contracts.venueSelectors.swap : '0x8a0ccd56'}",
  },
  tokens: {
    tokenA: "${deployments.contracts.tokens.tokenA}",
    tokenB: "${deployments.contracts.tokens.tokenB}",
  },
  agent: {
    address: "${deployments.agent.address}",
    agentId: ${deployments.agent.agentId},
    registrationTx: "${deployments.agent.registrationTx}",
  },
  verifiedExplorerUrl: "${deployments.verifiedExplorerUrl}",
} as const;

export const VENUE_SELECTORS = DEPLOYED_ADDRESSES.venueSelectors;

export const AGENT_GUARD_ABI = ${JSON.stringify(agentGuardArtifact.abi, null, 2)} as const;

export const MOCK_DEX_ABI = ${JSON.stringify(mockDexArtifact.abi, null, 2)} as const;

export const ERC20_ABI = [
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "account", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      { "name": "owner", "type": "address" },
      { "name": "spender", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view"
  }
] as const;

export const ERC8004_REGISTRY_ABI = [
  {
    "type": "function",
    "name": "register",
    "inputs": [{ "name": "uri", "type": "string" }],
    "outputs": [{ "name": "agentId", "type": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [{ "name": "tokenId", "type": "uint256" }],
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "to", "type": "address", "indexed": true },
      { "name": "tokenId", "type": "uint256", "indexed": true }
    ],
    "anonymous": false
  }
] as const;
`;

const outputPath = path.join(outputDir, 'generated.ts');
fs.writeFileSync(outputPath, generatedTs, 'utf8');
console.log('Artifacts generated successfully at:', outputPath);
