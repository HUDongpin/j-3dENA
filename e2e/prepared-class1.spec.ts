import { expect, test, type Download, type Page } from "@playwright/test";

import {
  SYNTHETIC_PREPARED_SHA256,
  expectOwnedResult,
  installWorkerProbe,
  loadSyntheticPreparedExchange,
  observeAnalysisTransport,
  testIds,
  workerEvents,
} from "./helpers/runtime-contract";

async function readDownloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readDownload(download: Download): Promise<string> {
  return (await readDownloadBytes(download)).toString("utf8");
}

async function runPrepared(page: Page, clickRun = true) {
  if (clickRun) {
    await page.getByTestId(testIds.run).click();
  }
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  const ownership = await expectOwnedResult(page);
  const result = page.getByTestId(testIds.result);
  await expect(result).toHaveAttribute("data-source-kind", "prepared-exchange");
  await expect(result).toHaveAttribute("data-raw-recomputed", "false");
  await expect(result).toHaveAttribute(
    "data-product-status",
    "IMPLEMENTED_UNVERIFIED",
  );
  await expect(result).toHaveAttribute(
    "data-prepared-evidence",
    "unverified-prepared-exchange",
  );
  expect(ownership.datasetHash).toBe(SYNTHETIC_PREPARED_SHA256);
  return ownership;
}

test.beforeEach(async ({ page }) => {
  await installWorkerProbe(page);
});

test("synthetic exact bytes reduce in a Worker and render a generic prepared shared space", async ({
  page,
}) => {
  const transport = observeAnalysisTransport(page);
  await page.goto("/app");
  await loadSyntheticPreparedExchange(page);

  transport.start();
  await runPrepared(page);

  const summary = page.getByTestId(testIds.preparedSummary);
  await expect(summary).toHaveAttribute("data-points", "6");
  await expect(summary).toHaveAttribute("data-nodes", "3");
  await expect(summary).toHaveAttribute("data-edges", "3");
  await expect(summary).toHaveAttribute("data-dimensions", "3");
  await expect(summary).toHaveAttribute("data-groups", "2");
  await expect(summary).toHaveAttribute("data-centroids", "6");
  await expect(page.getByText("No raw-row jENA recomputation was performed.")).toBeVisible();
  const evidence = page.getByTestId(testIds.preparedEvidenceStatus);
  await expect(evidence).toContainText("IMPLEMENTED_UNVERIFIED");
  await expect(evidence).toContainText("no built-in research-dataset identity");
  await expect(evidence).toContainText("no raw-row parity claim");

  expect(
    (await workerEvents(page)).filter(({ type }) => type === "create").length,
    "prepared import validation and analysis must use browser Workers",
  ).toBeGreaterThanOrEqual(2);
  transport.assertNone();
});

test("a failed prepared import is transactional and preserves the owned result", async ({
  page,
}) => {
  await page.goto("/app");
  await loadSyntheticPreparedExchange(page);
  const before = await runPrepared(page);

  await page.getByTestId(testIds.preparedFileInput).setInputFiles({
    name: "broken.ena3d.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"ena3d-exchange","version":1,"version":1}'),
  });
  await expect(page.getByTestId(testIds.preparedImportStatus)).toHaveAttribute(
    "data-state",
    "error",
  );
  await expect(page.getByTestId(testIds.preparedReceipt)).toHaveAttribute(
    "data-dataset-hash",
    SYNTHETIC_PREPARED_SHA256,
  );
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "completed",
  );
  const after = await expectOwnedResult(page);
  expect(after).toEqual(before);
});

test("prepared cancellation terminates the Worker and a replacement owns the rerun", async ({
  page,
}) => {
  await page.goto("/app?e2eWorkerDelayMs=1200");
  await loadSyntheticPreparedExchange(page);

  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    "running",
  );
  const firstWorker = await page
    .getByTestId(testIds.workerStatus)
    .getAttribute("data-worker-id");
  expect(firstWorker).toBeTruthy();

  await page.getByTestId(testIds.cancel).click();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "cancelled",
  );
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    "terminated",
  );
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId(testIds.result)).toBeHidden();
  await expect(page.getByTestId(testIds.status)).toHaveAttribute(
    "data-state",
    "cancelled",
  );

  await page.getByTestId(testIds.run).click();
  await expect(page.getByTestId(testIds.workerStatus)).toHaveAttribute(
    "data-state",
    "running",
  );
  const replacementWorker = await page
    .getByTestId(testIds.workerStatus)
    .getAttribute("data-worker-id");
  expect(replacementWorker).toBeTruthy();
  expect(replacementWorker).not.toBe(firstWorker);
  await runPrepared(page, false);

  const events = await workerEvents(page);
  expect(events.filter(({ type }) => type === "terminate").length).toBeGreaterThanOrEqual(2);
  expect(events.filter(({ type }) => type === "create").length).toBeGreaterThanOrEqual(3);
});

test("prepared browser exports carry all centroids and explicit candidate provenance", async ({
  page,
}) => {
  await page.goto("/app");
  await loadSyntheticPreparedExchange(page);
  await runPrepared(page);

  const centroidDownloadEvent = page.waitForEvent("download");
  await page.getByTestId(testIds.preparedExportCentroids).click();
  const centroidDownload = await centroidDownloadEvent;
  expect(centroidDownload.suggestedFilename()).toMatch(/prepared-centroids\.csv$/u);
  const centroidCsv = await readDownload(centroidDownload);
  const centroidLines = centroidCsv.trimEnd().split("\r\n");
  expect(centroidLines).toHaveLength(7);
  expect(centroidLines[0]).toBe(
    '"group_key","group_label","time_key","time_label","participant_count","SVD1","SVD2","SVD3"',
  );

  const provenanceDownloadEvent = page.waitForEvent("download");
  await page.getByTestId(testIds.preparedExportProvenance).click();
  const provenanceDownload = await provenanceDownloadEvent;
  expect(provenanceDownload.suggestedFilename()).toMatch(/prepared-provenance\.json$/u);
  const provenance = JSON.parse(await readDownload(provenanceDownload)) as {
    sourceKind: string;
    sourceReceipt: { sha256: string };
    rawJenaRecompute: boolean;
    analysisProvenance: { jenaExecuted: boolean };
  };
  expect(provenance.sourceKind).toBe("prepared-exchange");
  expect(provenance.sourceReceipt.sha256).toBe(SYNTHETIC_PREPARED_SHA256);
  expect(provenance.rawJenaRecompute).toBe(false);
  expect(provenance.analysisProvenance.jenaExecuted).toBe(false);
  expect(provenance).not.toHaveProperty("fixtureEvidence");

  const bundleDownloadEvent = page.waitForEvent("download");
  await page.getByTestId(testIds.preparedExportBundle).click();
  const bundleDownload = await bundleDownloadEvent;
  expect(bundleDownload.suggestedFilename()).toMatch(/prepared-result\.zip$/u);
  const bundle = await readDownloadBytes(bundleDownload);
  expect([...bundle.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(bundle.toString("utf8")).toContain("prepared-centroids.csv");
  expect(bundle.toString("utf8")).toContain("prepared-provenance.json");
});

test("prepared Comparison, Change, and Stats remain precomputed reductions with downloads", async ({
  page,
}) => {
  await page.goto("/app");
  await loadSyntheticPreparedExchange(page);
  await runPrepared(page);
  const workersBeforeDerived = (await workerEvents(page)).filter(
    ({ type }) => type === "create",
  ).length;

  await page.getByRole("tab", { name: "Comparison" }).click();
  await page.getByTestId("prepared-comparison-run").click();
  await expect(page.getByTestId("prepared-comparison-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("prepared-comparison-result")).toContainText(
    "jENA executed: no",
  );
  const comparisonDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("prepared-comparison-download").click();
  const comparison = JSON.parse(await readDownload(await comparisonDownloadEvent)) as {
    mode: string;
    productStatus: string;
    envelope: {
      schemaVersion: string;
      taskKind: string;
      evidence: { status: string; approvedForParity: boolean };
      provenance: {
        sourceKind: string;
        jenaExecuted: boolean;
        resultHash: string;
        schemaVersions: string[];
      };
      result: { schemaVersion: string };
    };
  };
  expect(comparison).toMatchObject({
    mode: "prepared-exchange",
    productStatus: "IMPLEMENTED_UNVERIFIED",
    envelope: {
      schemaVersion: "3dena.analysis-result-envelope.v1",
      taskKind: "network-comparison",
      evidence: {
        status: "IMPLEMENTED_UNVERIFIED",
        approvedForParity: false,
      },
      provenance: {
        sourceKind: "prepared-exchange",
        jenaExecuted: false,
        resultHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        schemaVersions: expect.arrayContaining([
          "3dena.prepared-space-result.v1",
          "3dena.network-comparison.v1",
        ]),
      },
      result: { schemaVersion: "3dena.network-comparison.v1" },
    },
  });

  await page.getByRole("tab", { name: "Change" }).click();
  await page.getByTestId("prepared-change-run").click();
  await expect(page.getByTestId("prepared-change-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("prepared-change-result")).toContainText(
    "longitudinal contrast: no",
  );
  const changeDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("prepared-change-download").click();
  const change = JSON.parse(await readDownload(await changeDownloadEvent)) as {
    envelope: { result: { schemaVersion: string } };
  };
  expect(change.envelope.result.schemaVersion).toBe("3dena.change-network.v1");

  await page.getByRole("tab", { name: "Stats" }).click();
  await page.getByTestId("prepared-statistics-alternative").selectOption("less");
  await page.getByTestId("prepared-statistics-adjustment").selectOption("bh");
  await page.getByTestId("prepared-statistics-run").click();
  await expect(page.getByTestId("prepared-statistics-status")).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("prepared-statistics-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("prepared-statistics-result")).toContainText("95% mean-difference CI");
  const statisticsDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("prepared-statistics-download").click();
  const statistics = JSON.parse(await readDownload(await statisticsDownloadEvent)) as {
    approvedForParity: boolean;
    envelope: {
      evidence: { approvedForParity: boolean };
      provenance: { sourceKind: string; jenaExecuted: boolean };
      result: {
        schemaVersion: string;
        design: string;
        dimensions: Array<{
          result: {
            alternative: string;
            adjustment: { method: string };
          };
        }>;
      };
    };
  };
  expect(statistics).toMatchObject({
    approvedForParity: false,
    envelope: {
      evidence: { approvedForParity: false },
      provenance: { sourceKind: "prepared-exchange", jenaExecuted: false },
      result: {
        schemaVersion: "3dena.statistics-task-result.v1",
        design: "independent",
      },
    },
  });
  expect(statistics.envelope.result.dimensions).toHaveLength(3);
  for (const dimension of statistics.envelope.result.dimensions) {
    expect(dimension.result).toMatchObject({
      alternative: "less",
      adjustment: { method: "bh" },
    });
  }
  await page.getByTestId("prepared-statistics-design").selectOption("paired");
  await expect(page.getByTestId("prepared-statistics-run")).toBeDisabled();
  await page.getByTestId("prepared-statistics-paired-confirmation").check();
  await expect(page.getByTestId("prepared-statistics-run")).toBeEnabled();
  const workersAfterDerived = (await workerEvents(page)).filter(
    ({ type }) => type === "create",
  ).length;
  expect(workersAfterDerived - workersBeforeDerived).toBe(3);
});
