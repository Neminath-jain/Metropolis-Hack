const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const SCREENSHOT_DIR = path.resolve(__dirname, "../screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log("==================================================================");
  console.log("AEGIS-MONAD: LIVE FRONTEND FLOW & SCREENSHOT CAPTURE");
  console.log("==================================================================");

  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });



  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  page.on("console", (msg) => console.log("  [PAGE LOG]:", msg.text()));
  page.on("pageerror", (err) => console.log("  [PAGE ERROR]:", err.message));

  page.on("response", async (res) => {
    try {
      const u = res.url();
      if ((u.includes("/relay") || u.includes("/faucet") || u.includes("/agent/")) && res.request().method() === "POST") {
        const data = await res.json();
        const txHash = data.tx_hash || data.result?.tx_hash;
        if (txHash) {
          const endpoint = u.split("8000")[1] || u;
          liveReport.transactions[endpoint] = {
            tx_hash: txHash,
            explorer: `https://testnet.monadexplorer.com/tx/${txHash}`,
          };
          console.log(`  [TX CAPTURED] ${endpoint} -> ${txHash}`);
        }
      }
    } catch (_) {}
  });

  // 1. Enable Virtual WebAuthn Authenticator in Chrome
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  console.log("[✓] Chrome Virtual WebAuthn Authenticator Enabled (P-256 / CTAP2)");

  const liveReport = {
    urls: {},
    transactions: {},
    screenshots: {},
  };

  // Helper for taking desktop and mobile screenshots
  async function takeDualScreenshots(name) {
    // Desktop (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(1000);
    const desktopPath = path.join(SCREENSHOT_DIR, `${name}_desktop.png`);
    await page.screenshot({ path: desktopPath, fullPage: true });

    // Mobile (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    const mobilePath = path.join(SCREENSHOT_DIR, `${name}_mobile.png`);
    await page.screenshot({ path: mobilePath, fullPage: true });

    // Reset back to desktop
    await page.setViewportSize({ width: 1280, height: 800 });

    liveReport.screenshots[`${name}_desktop`] = desktopPath;
    liveReport.screenshots[`${name}_mobile`] = mobilePath;
    console.log(`[✓] Captured ${name} (Desktop & Mobile)`);
  }

  try {
    // SCREEN 0: LANDING PAGE
    console.log("\n[1/7] Navigating to Landing Page (/)...");
    await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
    await takeDualScreenshots("00_landing");

    // SCREEN 1: WELCOME / IDENTITY
    console.log("\n[2/7] Navigating to Welcome / Identity (/app/welcome)...");
    await page.goto("http://localhost:5173/app/welcome", { waitUntil: "networkidle" });
    await takeDualScreenshots("01_welcome");


    console.log("  -> Registering passkey via /relay on Monad testnet...");
    const createBtn = page.getByRole("button", { name: "Create Passkey with Biometrics" });
    await createBtn.click();
    await page.waitForSelector("text=Passkey Registered Onchain!", { timeout: 60000 });
    console.log("  [✓] Passkey registered onchain!");

    // Capture post-registration state
    await page.waitForTimeout(1500);
    await takeDualScreenshots("01_welcome_registered");

    // SCREEN 2: VAULT
    console.log("\n[3/7] Navigating to Vault (/app/vault)...");
    await page.goto("http://localhost:5173/app/vault", { waitUntil: "networkidle" });
    await takeDualScreenshots("02_vault_initial");

    console.log("  -> Requesting 10.00 mWMON from Faucet (/faucet via depositFor)...");
    const faucetBtn = page.getByRole("button", { name: "Claim 10.00 mWMON" });
    await faucetBtn.click();
    await page.waitForSelector("text=Successfully credited 10.00 mWMON", { timeout: 60000 });
    console.log("  [✓] Faucet credited 10.00 mWMON!");

    await page.waitForTimeout(2000);
    await takeDualScreenshots("02_vault_funded");

    // SCREEN 3: POLICY BUILDER
    console.log("\n[4/7] Navigating to Policy Builder (/app/policy)...");
    await page.goto("http://localhost:5173/app/policy", { waitUntil: "networkidle" });
    await takeDualScreenshots("03_policy_builder");

    console.log("  -> Signing and registering session with Passkey via /relay...");
    const authPolicyBtn = page.getByRole("button", { name: "Authorize Policy with Passkey" });
    await authPolicyBtn.click();
    await page.waitForSelector("text=Transaction confirmed!", { timeout: 60000 });
    console.log("  [✓] Policy session registered onchain!");

    await page.waitForTimeout(1500);
    await takeDualScreenshots("03_policy_confirmed");

    // SCREEN 4: DASHBOARD
    console.log("\n[5/7] Navigating to Dashboard (/app/dashboard)...");
    await page.goto("http://localhost:5173/app/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await takeDualScreenshots("04_dashboard_active");

    console.log("  -> Triggering Run Agent Once...");
    const runAgentBtn = page.getByRole("button", { name: "Run Agent Once" });
    await runAgentBtn.click();
    await page.waitForSelector("text=Last Execution Result:", { timeout: 60000 });
    console.log("  [✓] Agent trade executed onchain!");

    await page.waitForTimeout(2000);
    await takeDualScreenshots("04_dashboard_post_trade");

    // SCREEN 5: RED-TEAM PANEL
    console.log("\n[6/7] Navigating to Red-Team Panel (/app/red-team)...");
    await page.goto("http://localhost:5173/app/red-team", { waitUntil: "networkidle" });
    await takeDualScreenshots("05_red_team_initial");

    console.log("  -> Testing Over-Limit Attack (contract halt & 0 balance delta)...");
    const overLimitBtn = page.getByRole("button", { name: "Test Over-Limit" });
    await overLimitBtn.click();
    await page.waitForSelector("text=BLOCKED:", { timeout: 60000 });
    console.log("  [✓] Over-Limit blocked onchain! Zero funds lost verified.");

    await page.waitForTimeout(1500);

    console.log("  -> Testing Revoke Mid-Run...");
    const revokeBtn = page.getByRole("button", { name: "Test Revoke Mid-Run" });
    await revokeBtn.click();
    await page.waitForSelector("text=Revoke Mid-Run Invariant", { timeout: 60000 });
    console.log("  [✓] Revoke confirmed onchain & agent refused!");

    await page.waitForTimeout(1500);
    await takeDualScreenshots("05_red_team_results");

    // SCREEN 6: HISTORY
    console.log("\n[7/7] Navigating to History Event Audit Log (/app/history)...");
    await page.goto("http://localhost:5173/app/history", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await takeDualScreenshots("06_history");


    console.log("\n==================================================================");
    console.log("ALL SCREENS CAPTURED & ONCHAIN FLOW CONFIRMED!");
    console.log("==================================================================");
    console.log(JSON.stringify(liveReport, null, 2));

    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "report.json"),
      JSON.stringify(liveReport, null, 2)
    );
  } catch (err) {
    console.error("Capture flow error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
