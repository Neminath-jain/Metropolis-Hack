/**
 * Aegis-Monad Passkey Quickstart Client Script
 * Handles real browser WebAuthn passkey registration, biometric signing,
 * and relaying to Monad testnet.
 */

import { createPublicClient, http, parseEther, type Address, type Hex } from "viem";
import {
  createAegisClient,
  createPasskey,
  signWithPasskey,
  buildChallenge,
  computePolicyHash,
  computeRegisterSessionPayloadHash,
  deriveUserId,
  PolicyBuilder,
  DEPLOYED_ADDRESSES,
  SECP256R1_N,
  SECP256R1_HALF_N,
  type PolicyConfig,
  type WebAuthnAuth,
} from "../../sdk/dist/index.js";

const RPC_URL = "https://testnet-rpc.monad.xyz";
const EXPLORER_BASE = "https://testnet.monadscan.com/tx/";

const publicClient = createPublicClient({ transport: http(RPC_URL) });
const aegis = createAegisClient({ publicClient });

// UI Elements
const btnCreate = document.getElementById("btn-create-passkey") as HTMLButtonElement;
const btnVirtual = document.getElementById("btn-virtual-auth") as HTMLButtonElement;
const btnRegister = document.getElementById("btn-register-passkey") as HTMLButtonElement;
const btnSign = document.getElementById("btn-sign-session") as HTMLButtonElement;
const btnVerify = document.getElementById("btn-verify-session") as HTMLButtonElement;

const outStep1 = document.getElementById("output-step1") as HTMLDivElement;
const outStep2 = document.getElementById("output-step2") as HTMLDivElement;
const outStep3 = document.getElementById("output-step3") as HTMLDivElement;
const outStep4 = document.getElementById("output-step4") as HTMLDivElement;

// Browser Virtual Authenticator for automated/headless or non-hardware testing
class BrowserVirtualAuthenticator {
  public qx: bigint = 0n;
  public qy: bigint = 0n;
  public userId: Address = "0x0000000000000000000000000000000000000000";
  private privateKey: CryptoKey | null = null;

  async initialize() {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    this.privateKey = keyPair.privateKey;
    const jwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const b64toHex = (b64: string) => {
      const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
      return Array.from(bin).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    };

    this.qx = BigInt("0x" + b64toHex(jwk.x!));
    this.qy = BigInt("0x" + b64toHex(jwk.y!));
    this.userId = deriveUserId(this.qx, this.qy);
  }

  async sign(challenge: Hex): Promise<WebAuthnAuth> {
    if (!this.privateKey) throw new Error("Virtual authenticator not initialized");

    const challengeHex = challenge.replace(/^0x/, "");
    const challengeBytes = new Uint8Array(challengeHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    let b64 = btoa(String.fromCharCode(...challengeBytes));
    const challengeB64Url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const origin = window.location.origin || "http://localhost:5173";
    const clientDataJSON = `{"type":"webauthn.get","challenge":"${challengeB64Url}","origin":"${origin}"}`;
    const enc = new TextEncoder();
    const clientDataHashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(clientDataJSON));
    const clientDataHash = new Uint8Array(clientDataHashBuffer);

    // AuthenticatorData: 37 bytes (32B rpIdHash + 1B flags (UP|UV = 0x05) + 4B counter)
    const hostname = window.location.hostname || "localhost";
    const rpIdHashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(hostname));
    const rpIdHash = new Uint8Array(rpIdHashBuffer);

    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(rpIdHash, 0);
    authenticatorData[32] = 0x05; // UP | UV
    authenticatorData[33] = 0;
    authenticatorData[34] = 0;
    authenticatorData[35] = 0;
    authenticatorData[36] = 1;

    // Msg to sign: authenticatorData || sha256(clientDataJSON)
    const msgToSign = new Uint8Array(37 + 32);
    msgToSign.set(authenticatorData, 0);
    msgToSign.set(clientDataHash, 37);

    // WebCrypto ECDSA sign produces IEEE P1363 (64 bytes: r (32B) || s (32B))
    const sigBuffer = await window.crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      this.privateKey,
      msgToSign
    );
    const sigBytes = new Uint8Array(sigBuffer);
    const rHex = Array.from(sigBytes.subarray(0, 32)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const sHex = Array.from(sigBytes.subarray(32, 64)).map((b) => b.toString(16).padStart(2, "0")).join("");

    let r = BigInt("0x" + rHex);
    let s = BigInt("0x" + sHex);

    // Normalize to low-s (prevent malleability)
    if (s > SECP256R1_HALF_N) {
      s = SECP256R1_N - s;
    }

    const toHexStr = (b: Uint8Array) => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

    return {
      authenticatorData: toHexStr(authenticatorData) as Hex,
      clientDataJSON,
      challengeIndex: BigInt(clientDataJSON.indexOf('"challenge":"')),
      typeIndex: BigInt(clientDataJSON.indexOf('"type":"webauthn.get"')),
      r: ("0x" + r.toString(16).padStart(64, "0")) as Hex,
      s: ("0x" + s.toString(16).padStart(64, "0")) as Hex,
    };
  }
}

// State
let currentQx: bigint | null = null;
let currentQy: bigint | null = null;
let currentUserId: Address | null = null;
let currentCredentialId: string | null = null;
let virtualAuth: BrowserVirtualAuthenticator | null = null;
let builtPolicy: PolicyConfig | null = null;

function showOutput(el: HTMLDivElement, html: string) {
  el.innerHTML = html;
  el.classList.add("visible");
}

// ---------------------------------------------------------------------------
// 1. CREATE BROWSER PASSKEY (REAL HARDWARE)
// ---------------------------------------------------------------------------
btnCreate.addEventListener("click", async () => {
  try {
    btnCreate.disabled = true;
    outStep1.textContent = "Requesting biometric passkey creation via navigator.credentials.create()...";
    outStep1.classList.add("visible");

    const passkey = await createPasskey({
      rpName: "Aegis Monad Demo",
      userName: "demo-user-" + Date.now().toString().slice(-4),
      userDisplayName: "Aegis Demo User",
    });

    currentQx = passkey.qx;
    currentQy = passkey.qy;
    currentUserId = passkey.userId;
    currentCredentialId = passkey.credentialId;
    virtualAuth = null;

    showOutput(
      outStep1,
      `<strong>Passkey Created Successfully!</strong>\n` +
      `<div class="field-row"><span class="field-label">Derived User ID:</span><span class="field-value">${passkey.userId}</span></div>` +
      `<div class="field-row"><span class="field-label">Credential ID:</span><span class="field-value">${passkey.credentialId.slice(0, 24)}...</span></div>` +
      `<div class="field-row"><span class="field-label">P256 Qx:</span><span class="field-value">0x${passkey.qx.toString(16).slice(0, 16)}...</span></div>` +
      `<div class="field-row"><span class="field-label">P256 Qy:</span><span class="field-value">0x${passkey.qy.toString(16).slice(0, 16)}...</span></div>`
    );

    btnRegister.disabled = false;
  } catch (err: any) {
    showOutput(outStep1, `<span style="color: #ef4444;">Passkey Creation Failed: ${err.message || String(err)}</span>`);
  } finally {
    btnCreate.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 1B. VIRTUAL AUTHENTICATOR (BROWSER TEST MODE)
// ---------------------------------------------------------------------------
btnVirtual.addEventListener("click", async () => {
  try {
    btnVirtual.disabled = true;
    virtualAuth = new BrowserVirtualAuthenticator();
    await virtualAuth.initialize();

    currentQx = virtualAuth.qx;
    currentQy = virtualAuth.qy;
    currentUserId = virtualAuth.userId;
    currentCredentialId = null;

    showOutput(
      outStep1,
      `<strong>Virtual P256 Authenticator Initialized (Test Mode)</strong>\n` +
      `<div class="field-row"><span class="field-label">Derived User ID:</span><span class="field-value">${currentUserId}</span></div>` +
      `<div class="field-row"><span class="field-label">P256 Qx:</span><span class="field-value">0x${virtualAuth.qx.toString(16).slice(0, 16)}...</span></div>` +
      `<div class="field-row"><span class="field-label">P256 Qy:</span><span class="field-value">0x${virtualAuth.qy.toString(16).slice(0, 16)}...</span></div>`
    );

    btnRegister.disabled = false;
  } catch (err: any) {
    showOutput(outStep1, `<span style="color: #ef4444;">Virtual Auth Error: ${err.message || String(err)}</span>`);
  } finally {
    btnVirtual.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 2. REGISTER PASSKEY ONCHAIN (GASLESS RELAYER)
// ---------------------------------------------------------------------------
btnRegister.addEventListener("click", async () => {
  if (!currentQx || !currentQy || !currentUserId) return;

  try {
    btnRegister.disabled = true;
    showOutput(outStep2, `Relaying registerPasskey(qx, qy) to Monad testnet...`);

    const res = await fetch("/api/relay/register-passkey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qx: currentQx.toString(),
        qy: currentQy.toString(),
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Relayer registration failed");

    showOutput(
      outStep2,
      `<strong>Passkey Registered on Monad Testnet!</strong>\n` +
      `<div class="field-row"><span class="field-label">User ID:</span><span class="field-value">${data.userId}</span></div>` +
      `<a class="tx-link" href="${EXPLORER_BASE}${data.txHash}" target="_blank">View on Explorer: ${data.txHash.slice(0, 18)}...</a>`
    );

    btnSign.disabled = false;
  } catch (err: any) {
    showOutput(outStep2, `<span style="color: #ef4444;">Registration Failed: ${err.message || String(err)}</span>`);
  } finally {
    btnRegister.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 3. SIGN & REGISTER SESSION WITH PASSKEY
// ---------------------------------------------------------------------------
btnSign.addEventListener("click", async () => {
  if (!currentUserId) return;

  try {
    btnSign.disabled = true;
    showOutput(outStep3, `Preparing policy and requesting biometric assertion...`);

    // 1. Build Policy
    builtPolicy = new PolicyBuilder(
      DEPLOYED_ADDRESSES.agent.address,
      BigInt(DEPLOYED_ADDRESSES.agent.agentId),
      86400n * 7n // 7 days
    )
      .allowToken(DEPLOYED_ADDRESSES.tokens.tokenA, parseEther("10"), parseEther("2"))
      .allowSelector(DEPLOYED_ADDRESSES.venue, DEPLOYED_ADDRESSES.venueSelectors.swap, true)
      .setMinRate(DEPLOYED_ADDRESSES.tokens.tokenA, DEPLOYED_ADDRESSES.tokens.tokenB, parseEther("1"))
      .build();

    const policyHash = computePolicyHash(builtPolicy);
    const payloadHash = computeRegisterSessionPayloadHash(
      builtPolicy.agent,
      builtPolicy.agentId,
      builtPolicy.expiresAt,
      policyHash
    );
    const nonce = await aegis.nextNonce(currentUserId);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // 2. Build WebAuthn Challenge matching contract
    const challenge = buildChallenge(
      "REGISTER_SESSION",
      currentUserId,
      payloadHash,
      nonce,
      deadline,
      DEPLOYED_ADDRESSES.agentGuard,
      BigInt(DEPLOYED_ADDRESSES.chainId)
    );

    // 3. Sign Challenge
    let auth: WebAuthnAuth;
    if (virtualAuth) {
      auth = await virtualAuth.sign(challenge);
    } else {
      auth = await signWithPasskey(challenge);
    }

    showOutput(
      outStep3,
      `<strong>Assertion Generated!</strong> Low-s Normalized.\n` +
      `Submitting to Monad testnet via relayer...`
    );

    // 4. Submit to Relayer
    const res = await fetch("/api/relay/register-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUserId,
        agent: builtPolicy.agent,
        agentId: builtPolicy.agentId.toString(),
        expiresAt: builtPolicy.expiresAt.toString(),
        policy: {
          ...builtPolicy,
          agentId: builtPolicy.agentId.toString(),
          expiresAt: builtPolicy.expiresAt.toString(),
          tokens: builtPolicy.tokens.map((t) => ({
            token: t.token,
            dailyLimit: t.dailyLimit.toString(),
            perTradeLimit: t.perTradeLimit.toString(),
          })),
          rates: builtPolicy.rates.map((r) => ({
            tokenIn: r.tokenIn,
            tokenOut: r.tokenOut,
            minRate: r.minRate.toString(),
          })),
        },
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        auth: {
          authenticatorData: auth.authenticatorData,
          clientDataJSON: auth.clientDataJSON,
          challengeIndex: auth.challengeIndex.toString(),
          typeIndex: auth.typeIndex.toString(),
          r: auth.r.toString(),
          s: auth.s.toString(),
        },
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Relay session registration failed");

    showOutput(
      outStep3,
      `<strong>Session Registered Successfully with Passkey!</strong>\n` +
      `<div class="field-row"><span class="field-label">Agent:</span><span class="field-value">${builtPolicy.agent}</span></div>` +
      `<div class="field-row"><span class="field-label">Policy Hash:</span><span class="field-value">${policyHash.slice(0, 18)}...</span></div>` +
      `<a class="tx-link" href="${EXPLORER_BASE}${data.txHash}" target="_blank">View on Explorer: ${data.txHash.slice(0, 18)}...</a>`
    );

    btnVerify.disabled = false;
  } catch (err: any) {
    showOutput(outStep3, `<span style="color: #ef4444;">Session Registration Failed: ${err.message || String(err)}</span>`);
  } finally {
    btnSign.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// 4. VERIFY ONCHAIN STATE
// ---------------------------------------------------------------------------
btnVerify.addEventListener("click", async () => {
  if (!currentUserId) return;

  try {
    btnVerify.disabled = true;
    showOutput(outStep4, `Querying AgentGuard contract on Monad testnet...`);

    const session = await aegis.getSession(currentUserId, DEPLOYED_ADDRESSES.agent.address);

    showOutput(
      outStep4,
      `<strong>Live Contract Verification:</strong>\n` +
      `<div class="field-row"><span class="field-label">Session Active:</span><span class="field-value" style="color: ${session.active ? '#06d6a0' : '#ef4444'};">${session.active}</span></div>` +
      `<div class="field-row"><span class="field-label">Agent ID:</span><span class="field-value">${session.agentId.toString()}</span></div>` +
      `<div class="field-row"><span class="field-label">Expires At:</span><span class="field-value">${new Date(Number(session.expiresAt) * 1000).toISOString()}</span></div>` +
      `<div class="field-row"><span class="field-label">Agent Address:</span><span class="field-value">${DEPLOYED_ADDRESSES.agent.address}</span></div>`
    );
  } catch (err: any) {
    showOutput(outStep4, `<span style="color: #ef4444;">Verification Failed: ${err.message || String(err)}</span>`);
  } finally {
    btnVerify.disabled = false;
  }
});
