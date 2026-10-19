import { defineConfig } from "vite";
import * as fs from "fs";
import * as path from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createAegisClient,
  DEPLOYED_ADDRESSES,
} from "../sdk/dist/index.js";

// Load relayer key from contracts/.env
let relayerKey: `0x${string}` | undefined;
const envPath = path.resolve(__dirname, "../contracts/.env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/DEPLOYER_KEY\s*=\s*([a-fA-F0-9x]+)/);
  if (match) {
    relayerKey = (match[1].startsWith("0x") ? match[1] : `0x${match[1]}`) as `0x${string}`;
  }
}

const RPC_URL = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";

export default defineConfig({
  root: ".",
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        passkey: path.resolve(__dirname, "passkey-quickstart.html"),
      },
    },
  },
  plugins: [
    {
      name: "aegis-relayer-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/relay")) {
            return next();
          }

          if (req.method === "POST" && req.url === "/api/relay/register-passkey") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
              try {
                const { qx, qy } = JSON.parse(body);
                if (!relayerKey) throw new Error("Relayer key not configured on server.");

                const account = privateKeyToAccount(relayerKey);
                const publicClient = createPublicClient({ transport: http(RPC_URL) });
                const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
                const aegis = createAegisClient({ publicClient, walletClient });

                const { txHash, userId } = await aegis.registerPasskey(BigInt(qx), BigInt(qy));
                await publicClient.waitForTransactionReceipt({ hash: txHash });

                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: true, txHash, userId }));
              } catch (err: any) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
              }
            });
            return;
          }

          if (req.method === "POST" && req.url === "/api/relay/register-session") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
              try {
                const data = JSON.parse(body);
                if (!relayerKey) throw new Error("Relayer key not configured on server.");

                const account = privateKeyToAccount(relayerKey);
                const publicClient = createPublicClient({ transport: http(RPC_URL) });
                const walletClient = createWalletClient({ account, transport: http(RPC_URL) });
                const aegis = createAegisClient({ publicClient, walletClient });

                const txHash = await aegis.registerSessionWithPasskey({
                  userId: data.userId,
                  agent: data.agent,
                  agentId: BigInt(data.agentId),
                  expiresAt: BigInt(data.expiresAt),
                  policy: {
                    ...data.policy,
                    agentId: BigInt(data.policy.agentId),
                    expiresAt: BigInt(data.policy.expiresAt),
                    tokens: data.policy.tokens.map((t: any) => ({
                      token: t.token,
                      dailyLimit: BigInt(t.dailyLimit),
                      perTradeLimit: BigInt(t.perTradeLimit),
                    })),
                    rates: data.policy.rates.map((r: any) => ({
                      tokenIn: r.tokenIn,
                      tokenOut: r.tokenOut,
                      minRate: BigInt(r.minRate),
                    })),
                  },
                  nonce: BigInt(data.nonce),
                  deadline: BigInt(data.deadline),
                  auth: {
                    authenticatorData: data.auth.authenticatorData,
                    clientDataJSON: data.auth.clientDataJSON,
                    challengeIndex: BigInt(data.auth.challengeIndex),
                    typeIndex: BigInt(data.auth.typeIndex),
                    r: data.auth.r.startsWith("0x") ? data.auth.r : `0x${data.auth.r}`,
                    s: data.auth.s.startsWith("0x") ? data.auth.s : `0x${data.auth.s}`,
                  },
                });

                await publicClient.waitForTransactionReceipt({ hash: txHash });

                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: true, txHash }));
              } catch (err: any) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
              }
            });
            return;
          }

          next();
        });
      },
    },
  ],
});
