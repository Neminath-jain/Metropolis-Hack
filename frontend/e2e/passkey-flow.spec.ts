import { test, expect } from "@playwright/test";

test.describe("Aegis-Monad Passkey End-to-End Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Initialize Chrome CDP Virtual WebAuthn Authenticator
    const cdp = await page.context().newCDPSession(page);
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
  });

  test("full passkey delegation lifecycle: landing -> passkey register -> faucet -> policy -> run agent -> attack blocked -> revoke", async ({
    page,
  }) => {
    // 1. Visit Landing Page
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Bounded, Revocable AI Agent Delegation");
    await expect(page.getByText("Integrate in 10 Lines of Code")).toBeVisible();
    await expect(page.getByText("Live Testnet Deployments")).toBeVisible();

    // 2. Launch App -> Welcome / Identity Selection
    await page.getByRole("link", { name: "Launch App" }).first().click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByText("Welcome to Aegis-Monad")).toBeVisible();

    // 3. Create & Register Passkey via Virtual Authenticator & Relayer
    const createPasskeyBtn = page.getByRole("button", { name: "Create Passkey with Biometrics" });
    await expect(createPasskeyBtn).toBeVisible();
    await createPasskeyBtn.click();

    // Wait for passkey creation & onchain relay confirmation
    await expect(page.getByText("Passkey Registered Onchain!")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Account ID:")).toBeVisible();

    // 4. Navigate to Vault & Claim Faucet
    await page.getByRole("link", { name: "Vault" }).click();
    await expect(page).toHaveURL(/\/app\/vault/);
    await expect(page.getByText("AgentGuard Smart Vault")).toBeVisible();

    await page.waitForTimeout(2000);
    const faucetBtn = page.getByRole("button", { name: "Claim 10.00 mWMON" });
    await expect(faucetBtn).toBeVisible();
    await faucetBtn.click();

    await expect(page.getByText("Successfully credited 10.00 mWMON")).toBeVisible({ timeout: 60000 });

    // 5. Navigate to Policy Builder
    await page.getByRole("link", { name: "Policy Builder" }).click();
    await expect(page).toHaveURL(/\/app\/policy/);
    await expect(page.getByText("Human-Readable Policy Summary")).toBeVisible();

    // Fill policy limits
    const perTradeInput = page.locator('input[placeholder="2.0"]');
    await perTradeInput.fill("1.5");

    await expect(page.getByText("swap up to 1.5 mWMON per trade")).toBeVisible();

    // Authorize policy with Passkey
    const authorizePolicyBtn = page.getByRole("button", { name: "Authorize Policy with Passkey" });
    await authorizePolicyBtn.click();

    await expect(page.getByText("Transaction confirmed!")).toBeVisible({ timeout: 60000 });

    // 6. Navigate to Dashboard & Run Agent Once
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByText("Agent #2372 Bounded by Onchain Policy")).toBeVisible();

    const runAgentBtn = page.getByRole("button", { name: "Run Agent Once" });
    await expect(runAgentBtn).toBeVisible();
    await runAgentBtn.click();

    await expect(page.getByText("Last Execution Result:")).toBeVisible({ timeout: 60000 });

    // 7. Navigate to Red-Team Security Validation
    await page.getByRole("link", { name: "Red-Team" }).click();
    await expect(page).toHaveURL(/\/app\/red-team/);
    await expect(page.getByText("Red-Team Security Validation")).toBeVisible();

    // Execute Over-Limit attack -> expect contract blocked & zero balance delta
    const testOverLimitBtn = page.getByRole("button", { name: "Test Over-Limit" });
    await testOverLimitBtn.click();

    await expect(page.getByText("BLOCKED: EXCEEDS_PER_TRADE")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Delta: 0.00 mWMON (Zero Funds Lost)")).toBeVisible();

    // Execute Revoke Mid-Run
    const testRevokeBtn = page.getByRole("button", { name: "Test Revoke Mid-Run" });
    await testRevokeBtn.click();

    await expect(page.getByText("Revoke Mid-Run Invariant")).toBeVisible({ timeout: 60000 });

    // 8. Navigate to History Event Audit Log
    await page.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByText("Onchain Event Audit Log")).toBeVisible();
  });
});
