import {
  createPublicClient,
  http,
  defineChain,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import {
  createAegisClient,
  AGENT_GUARD_ABI,
  buildChallenge,
  computePolicyHash,
  computeRegisterSessionPayloadHash,
  computeRevokeSessionPayloadHash,
  computeWithdrawPayloadHash,
  toOnchainPolicy,
  signWithPasskey,
  type PolicyConfig,
  type OnchainPolicy,
  type WebAuthnAuth,
} from "@aegis-monad/sdk";
import { CONFIG } from "../config";

export const monadTestnet = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.networkName,
  nativeCurrency: {
    name: "MON",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [CONFIG.rpcUrl],
    },
    public: {
      http: [CONFIG.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "MonadScan",
      url: CONFIG.explorerBaseUrl,
    },
  },
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(CONFIG.rpcUrl),
});

export const aegisClient = createAegisClient({
  publicClient,
  guardAddress: CONFIG.contracts.agentGuard,
  registryAddress: CONFIG.contracts.registry,
});

export interface RelayResult {
  status: string;
  tx_hash: string;
  gas_limit: number;
  explorer_url: string;
  function_name: string;
}

export interface FaucetResult {
  status: string;
  user: string;
  token: string;
  token_symbol: string;
  amount_wei: string;
  amount_formatted: string;
  tx_hash: string;
  explorer_url: string;
  is_mock: boolean;
  note: string;
}

export interface ExecutionResult {
  status: "success" | "policy_violation" | "rejected_by_guardrails" | "reverted";
  tx_hash?: string;
  decision_hash?: string;
  reason_code?: number;
  reason_name?: string;
  spent?: number;
  received?: number;
  details?: string;
}

/**
 * Submits calldata through the backend gas relayer
 */
export async function relayTransaction(target: Address, data: Hex, userId?: Address): Promise<RelayResult> {
  const res = await fetch(`${CONFIG.backendUrl}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target,
      data,
      user_id: userId,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Relay request failed with HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Requests mock tokens deposited directly into user's vault
 */
export async function claimFaucetTokens(user: Address, token?: Address, amountWei?: number): Promise<FaucetResult> {
  const res = await fetch(`${CONFIG.backendUrl}/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      token,
      amount: amountWei,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Faucet request failed with HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Executes a single trade cycle by the autonomous agent
 */
export async function runAgentOnce(user: Address, tokenIn?: Address, tokenOut?: Address): Promise<ExecutionResult> {
  const res = await fetch(`${CONFIG.backendUrl}/agent/run-once`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      token_in: tokenIn,
      token_out: tokenOut,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Run-once failed with HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Triggers red-team demo attack to verify onchain contract blocks it
 */
export async function triggerRedTeamAttack(
  kind: "over_limit" | "bad_target" | "bad_selector",
  user: Address,
  customAmount?: number
): Promise<ExecutionResult> {
  const res = await fetch(`${CONFIG.backendUrl}/agent/attack/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      custom_amount: customAmount,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `Attack request failed with HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Registers P256 passkey coordinates onchain via relayer
 */
export async function registerPasskeyOnchain(qx: bigint, qy: bigint): Promise<RelayResult> {
  const data = encodeFunctionData({
    abi: AGENT_GUARD_ABI,
    functionName: "registerPasskey",
    args: [qx, qy],
  });

  return relayTransaction(CONFIG.contracts.agentGuard, data);
}

/**
 * Registers an agent delegation policy using a WebAuthn passkey assertion via relayer
 */
export async function registerSessionWithPasskeyViaRelay(params: {
  userId: Address;
  agent: Address;
  agentId: bigint;
  expiresAt: bigint;
  policy: PolicyConfig;
}): Promise<RelayResult> {
  const { userId, agent, agentId, expiresAt, policy } = params;

  // 1. Fetch next nonce from contract
  const nonce = await aegisClient.nextNonce(userId);

  // 2. Compute policyHash and payloadHash
  const onchain = toOnchainPolicy(policy);
  const policyHash = computePolicyHash(onchain);
  const payloadHash = computeRegisterSessionPayloadHash(agent, agentId, expiresAt, policyHash);

  // 3. Deadline = 10 minutes into future
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // 4. Construct typed challenge hash using SDK with correct arguments
  const challenge = buildChallenge(
    "REGISTER_SESSION",
    userId,
    payloadHash,
    nonce,
    deadline,
    CONFIG.contracts.agentGuard,
    BigInt(CONFIG.chainId)
  );

  // 5. Prompt biometric authenticator in browser
  const auth = await signWithPasskey(challenge);

  // 6. Encode calldata
  const data = encodeFunctionData({
    abi: AGENT_GUARD_ABI,
    functionName: "registerSessionWithPasskey",
    args: [
      userId,
      agent,
      agentId,
      expiresAt,
      onchain as unknown as OnchainPolicy,
      nonce,
      deadline,
      auth as unknown as WebAuthnAuth,
    ],
  });

  // 7. Submit via relayer
  return relayTransaction(CONFIG.contracts.agentGuard, data, userId);
}

/**
 * Revokes an agent delegation policy using a WebAuthn passkey assertion via relayer
 */
export async function revokeSessionWithPasskeyViaRelay(userId: Address, agent: Address): Promise<RelayResult> {
  const nonce = await aegisClient.nextNonce(userId);
  const payloadHash = computeRevokeSessionPayloadHash(agent);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const challenge = buildChallenge(
    "REVOKE_SESSION",
    userId,
    payloadHash,
    nonce,
    deadline,
    CONFIG.contracts.agentGuard,
    BigInt(CONFIG.chainId)
  );

  const auth = await signWithPasskey(challenge);

  const data = encodeFunctionData({
    abi: AGENT_GUARD_ABI,
    functionName: "revokeSessionWithPasskey",
    args: [userId, agent, nonce, deadline, auth as unknown as WebAuthnAuth],
  });

  return relayTransaction(CONFIG.contracts.agentGuard, data, userId);
}

/**
 * Withdraws tokens using a WebAuthn passkey assertion via relayer
 */
export async function withdrawWithPasskeyViaRelay(params: {
  userId: Address;
  token: Address;
  amount: bigint;
  to: Address;
}): Promise<RelayResult> {
  const { userId, token, amount, to } = params;
  const nonce = await aegisClient.nextNonce(userId);
  const payloadHash = computeWithdrawPayloadHash(token, amount, to);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const challenge = buildChallenge(
    "WITHDRAW",
    userId,
    payloadHash,
    nonce,
    deadline,
    CONFIG.contracts.agentGuard,
    BigInt(CONFIG.chainId)
  );

  const auth = await signWithPasskey(challenge);

  const data = encodeFunctionData({
    abi: AGENT_GUARD_ABI,
    functionName: "withdrawWithPasskey",
    args: [userId, token, amount, to, nonce, deadline, auth as unknown as WebAuthnAuth],
  });

  return relayTransaction(CONFIG.contracts.agentGuard, data, userId);
}
