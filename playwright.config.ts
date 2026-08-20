import { defineConfig, devices } from "@playwright/test";

function configuredPort(): number {
  const raw = process.env.PLAYWRIGHT_PORT ?? "3217";
  if (!/^\d{4,5}$/u.test(raw)) {
    throw new Error("PLAYWRIGHT_PORT must be a numeric TCP port.");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("PLAYWRIGHT_PORT must be between 1024 and 65535.");
  }
  return port;
}

// A managed run owns a dedicated, configurable port. An explicitly supplied
// base URL may target a separately managed build, but the setup project still
// requires the j-3dENA /build-info identity before any product test runs.
const localPort = configuredPort();
const baseURL = (
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${localPort}`
).replace(/\/+$/u, "");
const suppliedServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
const managedBuildId = process.env.PLAYWRIGHT_EXPECTED_BUILD_ID
  ?? `playwright-managed-${localPort}`;
if (!suppliedServer && !process.env.PLAYWRIGHT_EXPECTED_BUILD_ID) {
  process.env.PLAYWRIGHT_EXPECTED_BUILD_ID = managedBuildId;
}

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
      name: "app-identity",
      testMatch: /app-identity\.setup\.ts$/,
    },
    {
      name: "chromium",
      dependencies: ["app-identity"],
      testIgnore: [/\.a11y\.spec\.ts$/, /app-identity\.setup\.ts$/],
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
    {
      name: "firefox",
      dependencies: ["app-identity"],
      testIgnore: [/\.a11y\.spec\.ts$/, /app-identity\.setup\.ts$/],
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit",
      dependencies: ["app-identity"],
      testIgnore: [/\.a11y\.spec\.ts$/, /app-identity\.setup\.ts$/],
      use: {
        ...devices["Desktop Safari"],
      },
    },
    {
      name: "a11y",
      dependencies: ["app-identity"],
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
          `npm run dev --workspace @3dena/web -- --hostname localhost --port ${localPort}`,
        url: `${baseURL}/build-info`,
        env: {
          THREEDENA_BUILD_ID: managedBuildId,
        },
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
