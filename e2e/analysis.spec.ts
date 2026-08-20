import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  expectOwnedResult,
  installWorkerProbe,
  observeAnalysisTransport,
  testIds,
  workerEvents,
} from "./helpers/runtime-contract";

const SMALL_RAW_CSV = resolve(
  process.cwd(),
  "packages/parity-contracts/fixtures/small-raw.csv",
);

async function uploadSmallRaw(page: Parameters<typeof installWorkerProbe>[0]) {
  expect(
    existsSync(SMALL_RAW_CSV),
    `governed E2E fixture is missing: ${SMALL_RAW_CSV}`,
  ).toBe(true);
  await page.getByTestId(testIds.rawFileInput).setInputFiles(SMALL_RAW_CSV);
  // setInputFiles dispatches the change event, but the product intentionally
  // stages File.text(), CSV parsing, mapping, and row validation before it
  // atomically commits the dataset. The Run button is already enabled for the
  // bundled sample, so its enabled state alone is not an upload-complete gate.
  await expect(page.locator(".dataset-receipt")).toContainText("Local file");
  await expect(page.getByTestId(testIds.run)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await installWorkerProbe(page);
});

test("small CSV runs in a Worker and renders an owned Plotly result", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app");
  await uploadSmallRaw(page);

  transport.start();
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-worker-id",
    /\S+/,
  );
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    /\S+/,
  );
  await expectOwnedResult(page);

  expect(
    (await workerEvents(page)).filter(({ type }) => type === "create").length,
    "analysis must construct at least one browser Worker",
  ).toBeGreaterThanOrEqual(1);
  transport.assertNone();
});

test("cancelling terminates the Worker and rejects a late result", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app?e2eWorkerDelayMs=1200");
  await uploadSmallRaw(page);

  transport.start();
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    "running",
  );
  const activeWorkerId = await page
    .getByTestId(testIds.workerStatus)
    .getAttribute("data-worker-id");
  expect(activeWorkerId).toBeTruthy();
  await page.getByTestId(testIds.cancel).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "cancelled",
  );

  expect(
    (await workerEvents(page)).some(({ type }) => type === "terminate"),
    "cancel must hard-terminate the active Worker",
  ).toBe(true);

  // Wait beyond the deterministic test delay: the terminated run may never
  // repopulate either status or visualization.
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "cancelled",
  );
  await expect(page.getByTestId(testIds.result)).toBeHidden();

  // Reconstruction may be lazy, but the next run must create a different
  // Worker identity rather than revive the terminated instance.
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    "running",
  );
  const replacementWorkerId = await page
    .getByTestId(testIds.workerStatus)
    .getAttribute("data-worker-id");
  expect(replacementWorkerId).toBeTruthy();
  expect(replacementWorkerId).not.toBe(activeWorkerId);
  expect(
    (await workerEvents(page)).filter(({ type }) => type === "create").length,
    "rerun after cancel must construct a replacement Worker",
  ).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expectOwnedResult(page);
  transport.assertNone();
});

test("changing analysis configuration invalidates and re-owns the result", async ({
  page,
}) => {
  await page.goto("/app");
  await uploadSmallRaw(page);
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  const first = await expectOwnedResult(page);

  const windowSize = page.getByTestId(testIds.windowSize);
  const oldWindowSize = Number(await windowSize.inputValue());
  const newWindowSize = oldWindowSize === 3 ? 4 : 3;
  await windowSize.fill(String(newWindowSize));
  await windowSize.blur();

  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "invalidated",
  );
  await expect(page.getByTestId(testIds.result)).toBeHidden();

  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  const second = await expectOwnedResult(page);
  expect(second.datasetHash).toBe(first.datasetHash);
  expect(second.specHash).not.toBe(first.specHash);
  expect(second.runId).not.toBe(first.runId);
});
