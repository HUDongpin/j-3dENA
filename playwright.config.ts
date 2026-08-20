import { defineConfig, devices } from "@playwright/test";

// Match the hostname announced by `next dev`. Next.js rejects development
// resources from a different origin (for example 127.0.0.1 versus localhost),
// which would leave acceptance tests exercising only server-rendered markup.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const suppliedServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  // Next development compilation can emit a one-time full reload while a
  // previously unseen route or client chunk is being built. Running the local
  // acceptance matrix in one browser worker keeps that dev-only reload from
  // invalidating an unrelated analysis page; production behavior is covered
  // separately by the optimized-build checks.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: "output/playwright/test-results",
  reporter: process.env.CI
    ? [
        ["github"],
        [
          "html",
          {
            outputFolder: "output/playwright/report",
            open: "never",
          },
        ],
      ]
    : [
        ["list"],
        [
          "html",
          {
            outputFolder: "output/playwright/report",
            open: "never",
          },
        ],
      ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /\.a11y\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
    {
      name: "a11y",
      testMatch: /\.a11y\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
  ],
  webServer: suppliedServer
    ? undefined
    : {
        command:
          process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
          "npm run dev --workspace @3dena/web",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
