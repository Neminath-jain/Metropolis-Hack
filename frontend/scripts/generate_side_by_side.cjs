const { chromium } = require("@playwright/test");
const path = require("path");

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage({
    viewport: { width: 2560, height: 1600 },
  });

  const refPath = path.resolve(__dirname, "../design/reference/screen.png").replace(/\\/g, "/");
  const landingPath = path.resolve(__dirname, "../screenshots/00_landing_desktop.png").replace(/\\/g, "/");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Side-by-Side Comparison: Stitch Reference vs Built Landing Page</title>
      <style>
        body {
          margin: 0;
          padding: 30px;
          background: #090d16;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #f1f5f9;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .header h1 {
          font-size: 28px;
          margin: 0 0 8px 0;
          color: #ffffff;
        }
        .header p {
          color: #94a3b8;
          font-size: 16px;
          margin: 0;
        }
        .container {
          display: flex;
          gap: 30px;
          align-items: flex-start;
          justify-content: center;
        }
        .column {
          flex: 1;
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }
        .column-header {
          padding: 16px 20px;
          background: #1e293b;
          font-weight: 600;
          font-size: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .badge {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 6px;
          background: #334155;
          color: #94a3b8;
        }
        .badge.active {
          background: #0284c7;
          color: #ffffff;
        }
        .column img {
          width: 100%;
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Aegis-Monad Visual Design Fidelity Comparison</h1>
        <p>Stitch Reference Design Language vs. Fully Built Landing Page (Token-Exact Implementation)</p>
      </div>
      <div class="container">
        <div class="column">
          <div class="column-header">
            <span>Stitch Project Screen #202f54c330664e909b5dbe1e6a9722e3</span>
            <span class="badge">Visual Source</span>
          </div>
          <img src="file:///${refPath}" alt="Stitch Reference" />
        </div>
        <div class="column">
          <div class="column-header">
            <span>Aegis-Monad Built Landing Page (Vite + React + Tailwind)</span>
            <span class="badge active">Built App</span>
          </div>
          <img src="file:///${landingPath}" alt="Built Landing" />
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const outputPath = path.resolve(__dirname, "../screenshots/side_by_side_comparison.png");
  await page.screenshot({ path: outputPath, fullPage: true });

  console.log("[✓] Side-by-side comparison saved to:", outputPath);
  await browser.close();
}

main().catch(console.error);
