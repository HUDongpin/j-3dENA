import { readFileSync } from "node:fs";
import { expect, test, type Download } from "@playwright/test";

import {
  expectOwnedResult,
  installWorkerProbe,
  observeAnalysisTransport,
  SMALL_RAW_CSV,
  testIds,
  uploadSmallRaw,
  workerEvents,
} from "./helpers/runtime-contract";

async function readJsonDownload(download: Download): Promise<Record<string, unknown>> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await installWorkerProbe(page);
});

test("small CSV runs in a Worker and renders an owned Plotly result", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app");
  // Observe the complete local-data lifecycle, including File selection,
  // transactional staging, Worker analysis, and Plotly publication.
  transport.start();
  await uploadSmallRaw(page);

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
  const result = page.getByTestId(testIds.result);
  await expect(result).toHaveAttribute(
    "data-product-status",
    "IMPLEMENTED_UNVERIFIED",
  );
  await expect(result).toHaveAttribute(
    "data-evidence-status",
    "PARITY_CANDIDATE",
  );
  await expect(result).toHaveAttribute(
    "data-evidence-scope",
    "3dena.small-raw-evidence-scope.v2",
  );
  await expect(result).toHaveAttribute(
    "data-evidence-build-id",
    /^(?!local-development$).+/u,
  );
  await expect(page.getByTestId(testIds.rawEvidenceStatus)).toContainText(
    "Only this exact fixture, specification, explicit build identity",
  );

  expect(
    (await workerEvents(page)).filter(({ type }) => type === "create").length,
    "analysis must construct at least one browser Worker",
  ).toBeGreaterThanOrEqual(1);
  transport.assertNone();
});

test("a user CSV with the governed filename does not inherit small-raw evidence", async ({
  page,
}) => {
  await page.goto("/app");
  const governedBytes = readFileSync(SMALL_RAW_CSV, "utf8");
  const modifiedBytes = governedBytes.replace(
    '"Experimental","Lesson 1","Student 1",0,0,1,1',
    '"Experimental","Lesson 1","Student 1",1,0,1,1',
  );
  expect(modifiedBytes).not.toBe(governedBytes);

  await page.getByTestId(testIds.rawFileInput).setInputFiles({
    name: "small-raw.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(modifiedBytes, "utf8"),
  });
  await expect(page.locator(".dataset-receipt")).toContainText("Local file");
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );

  const result = page.getByTestId(testIds.result);
  await expect(result).toHaveAttribute(
    "data-product-status",
    "IMPLEMENTED_UNVERIFIED",
  );
  await expect(result).toHaveAttribute(
    "data-evidence-status",
    "IMPLEMENTED_UNVERIFIED",
  );
  await expect(result).toHaveAttribute(
    "data-evidence-scope",
    "unscoped-local-result",
  );
  await expect(page.getByTestId(testIds.rawEvidenceStatus)).toContainText(
    "It carries no parity-candidate claim",
  );
});

test("cancelling terminates the Worker and rejects a late result", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app?e2eWorkerDelayMs=1200");
  transport.start();
  await uploadSmallRaw(page);

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
  await expect(page.getByTestId(testIds.result)).toHaveAttribute(
    "data-evidence-status",
    "PARITY_CANDIDATE",
  );

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
  await expect(page.getByTestId(testIds.result)).toHaveAttribute(
    "data-evidence-status",
    "IMPLEMENTED_UNVERIFIED",
  );
  await expect(page.getByTestId(testIds.rawEvidenceStatus)).toContainText(
    "It carries no parity-candidate claim",
  );
});

test("raw Comparison, Change, and Stats run real owned tasks with downloads", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app");
  await uploadSmallRaw(page);
  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expectOwnedResult(page);
  const workersBeforeDerived = (await workerEvents(page)).filter(
    ({ type }) => type === "create",
  ).length;
  transport.start();

  await page.getByRole("tab", { name: "Comparison" }).click();
  await page.getByTestId("raw-comparison-run").click();
  await expect(page.getByTestId("raw-comparison-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("raw-comparison-table").locator("tbody tr")).toHaveCount(6);
  const comparisonDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("raw-comparison-download").click();
  const comparisonDownload = await comparisonDownloadEvent;
  const comparison = await readJsonDownload(comparisonDownload);
  expect(comparison).toMatchObject({
    schemaVersion: "3dena.web-derived-download.v1",
    productStatus: "IMPLEMENTED_UNVERIFIED",
    approvedForParity: false,
    mode: "raw-jena",
    feature: "comparison",
    envelope: {
      schemaVersion: "3dena.analysis-result-envelope.v1",
      taskKind: "network-comparison",
      result: { schemaVersion: "3dena.network-comparison.v1" },
      evidence: { status: "IMPLEMENTED_UNVERIFIED", approvedForParity: false },
    },
  });
  const comparisonGroupA = await page.getByTestId("raw-comparison-group-a").inputValue();
  await page.getByTestId("raw-comparison-group-b").selectOption(comparisonGroupA);
  await expect(page.getByTestId("raw-comparison-status")).toHaveAttribute(
    "data-state",
    "stale",
  );
  await expect(page.getByTestId("raw-comparison-result")).toBeHidden();
  await expect(page.getByTestId("raw-comparison-run")).toBeDisabled();

  await page.getByRole("tab", { name: "Change" }).click();
  await page.getByTestId("raw-change-run").click();
  await expect(page.getByTestId("raw-change-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("raw-change-table").locator("tbody tr")).toHaveCount(6);
  const changeDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("raw-change-download").click();
  const change = await readJsonDownload(await changeDownloadEvent);
  expect(change).toMatchObject({
    mode: "raw-jena",
    feature: "change",
    envelope: {
      taskKind: "change-network",
      result: { schemaVersion: "3dena.change-network.v1" },
    },
  });

  await page.getByRole("tab", { name: "Stats" }).click();
  await page.getByTestId("raw-statistics-run").click();
  await expect(page.getByTestId("raw-statistics-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("raw-statistics-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("raw-statistics-table")).toContainText("95% mean-difference CI");
  await expect(page.getByTestId("raw-statistics-table")).toContainText("welch-t-mean-difference-v1");
  const statsDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("raw-statistics-download").click();
  const statistics = await readJsonDownload(await statsDownloadEvent);
  expect(statistics).toMatchObject({
    mode: "raw-jena",
    feature: "statistics",
    envelope: {
      taskKind: "statistics",
      result: {
        schemaVersion: "3dena.statistics-task-result.v1",
        design: "independent",
      },
    },
  });

  const workersAfterDerived = (await workerEvents(page)).filter(
    ({ type }) => type === "create",
  ).length;
  expect(workersAfterDerived - workersBeforeDerived).toBe(3);
  transport.assertNone();
});
