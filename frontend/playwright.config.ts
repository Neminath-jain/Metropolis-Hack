import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run preview -- --port 5173",
      port: 5173,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },

  ],
});
