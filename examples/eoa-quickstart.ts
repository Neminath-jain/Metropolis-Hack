/**
 * Aegis-Monad EOA Quickstart
 * Runnable Node script on Monad testnet:
 * Connects, deposits into the vault, registers a session for the reference agent, and reads the session back.
 *
 * Core integration logic is ~10 lines of code.
 */

import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "fs";
import * as path from "path";
import {
  createAegisClient,
  PolicyBuilder,
  DEPLOYED_ADDRESSES,
} from "../sdk/dist/index.js";

// Load configuration from local env
const envPath = path.resolve(process.cwd(), "contracts/.env");
let privateKey: `0x${string}` | undefined;

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/USER_PRIVATE_KEY\s*=\s*([a-fA-F0-9x]+)/);
  if (match) {
    privateKey = (match[1].startsWith("0x") ? match[1] : `0x${match[1]}`) as `0x${string}`;
  }
}

if (!privateKey) {
  privateKey = process.env.USER_PRIVATE_KEY as `0x${string}`;
}

if (!privateKey) {
  console.error("Missing USER_PRIVATE_KEY in contracts/.env or process.env");
  process.exit(1);
}

const RPC_URL = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const EXPLORER_BASE = "https://testnet.monadscan.com/tx/";

async function main() {
  console.log("==================================================================");
  console.log("AEGIS-MONAD: EOA QUICKSTART (LIVE MONAD TESTNET)");
  console.log("==================================================================");

  const account = privateKeyToAccount(privateKey!);
  console.log("Connected User Address:", account.address);

  // --- 10 LINES OF INTEGRATION CODE START ---
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
  const aegis = createAegisClient({ publicClient, walletClient });

  console.log("\n[1/3] Depositing 1.0 mWMON into AgentGuard vault...");
  const depTx = await aegis.deposit(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("1"));
  await publicClient.waitForTransactionReceipt({ hash: depTx });
  console.log(`Deposit Confirmed: ${EXPLORER_BASE}${depTx}`);

  console.log("\n[2/3] Configuring and registering agent delegation policy...");
  const policy = new PolicyBuilder(
    DEPLOYED_ADDRESSES.agent.address,
    BigInt(DEPLOYED_ADDRESSES.agent.agentId),
    86400n * 7n // 7 days
  )
    .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
    .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
    .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
    .build();

  const { hash: sessionTx } = await aegis.grantAgent(policy);
  console.log(`Policy Registration Confirmed: ${EXPLORER_BASE}${sessionTx}`);

  console.log("\n[3/3] Reading back active session from onchain state...");
  const session = await aegis.getSession(account.address, DEPLOYED_ADDRESSES.agent.address);
  // --- INTEGRATION CODE END ---

  console.log("\n==================================================================");
  console.log("ONCHAIN SESSION VERIFIED:");
  console.log(`  Active:     ${session.active}`);
  console.log(`  Expires At: ${new Date(Number(session.expiresAt) * 1000).toISOString()}`);
  console.log(`  Agent ID:   ${session.agentId.toString()}`);
  console.log(`  Agent Addr: ${DEPLOYED_ADDRESSES.agent.address}`);
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Quickstart error:", err);
  process.exit(1);
});
