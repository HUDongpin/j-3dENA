import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

export const SMALL_RAW_CSV = resolve(
  process.cwd(),
  "packages/parity-contracts/fixtures/small-raw.csv",
);

function syntheticPreparedExchangeBytes(): Buffer {
  const rows = [
    ["synthetic-1", "A", "alpha", "TP1", 0.1, 0.2, 0.3],
    ["synthetic-2", "A", "beta", "TP2", 0.2, 0.3, 0.4],
    ["synthetic-3", "A", "gamma", "TP3", 0.3, 0.4, 0.5],
    ["synthetic-4", "B", "delta", "TP1", -0.1, -0.2, -0.3],
    ["synthetic-5", "B", "epsilon", "TP2", -0.2, -0.3, -0.4],
    ["synthetic-6", "B", "zeta", "TP3", -0.3, -0.4, -0.5],
  ] as const;
  const metadata = [
    { name: "ENA_UNIT", type: "character", values: rows.map((row) => row[0]) },
    { name: "Group", type: "character", values: rows.map((row) => row[1]) },
    { name: "Speaker", type: "character", values: rows.map((row) => row[2]) },
    { name: "Period", type: "character", values: rows.map((row) => row[3]) },
  ];
  const edges = [
    { name: "A & B", type: "character", values: ["A", "B"] },
    { name: "A & C", type: "character", values: ["A", "C"] },
    { name: "B & C", type: "character", values: ["B", "C"] },
  ];
  return Buffer.from(JSON.stringify({
    format: "ena3d-exchange",
    version: 1,
    dimensions: ["SVD1", "SVD2", "SVD3"],
    group_variables: ["Group", "Speaker", "Period"],
    tables: {
      meta_data: { columns: metadata },
      points: { columns: [
        ...metadata,
        { name: "SVD1", type: "double", values: rows.map((row) => row[4]) },
        { name: "SVD2", type: "double", values: rows.map((row) => row[5]) },
        { name: "SVD3", type: "double", values: rows.map((row) => row[6]) },
      ] },
      line_weights: { columns: [
        ...metadata,
        ...edges.map(({ name }) => ({ name, type: "double", values: rows.map(() => 0.25) })),
      ] },
      nodes: { columns: [
        { name: "code", type: "character", values: ["A", "B", "C"] },
        { name: "SVD1", type: "double", values: [1, 0, 0] },
        { name: "SVD2", type: "double", values: [0, 1, 0] },
        { name: "SVD3", type: "double", values: [0, 0, 1] },
      ] },
      adjacency_key: { columns: edges },
    },
  }));
}

export const SYNTHETIC_PREPARED_BYTES = syntheticPreparedExchangeBytes();
export const SYNTHETIC_PREPARED_SHA256 = createHash("sha256")
  .update(SYNTHETIC_PREPARED_BYTES)
  .digest("hex");

export const PRODUCT_ROUTES = ["/", "/app", "/papers", "/team", "/about"] as const;

export const testIds = {
  appShell: "app-shell",
  routeMain: "route-main",
  rawFileInput: "raw-file-input",
  workspace: "analysis-workspace",
  rawMode: "analysis-mode-raw",
  preparedMode: "analysis-mode-prepared",
  preparedFileInput: "prepared-file-input",
  preparedImportStatus: "prepared-import-status",
  preparedReceipt: "prepared-dataset-receipt",
  preparedSummary: "prepared-summary",
  preparedEvidenceStatus: "prepared-evidence-status",
  preparedExportCentroids: "prepared-export-centroids",
  preparedExportProvenance: "prepared-export-provenance",
  preparedExportBundle: "prepared-export-bundle",
  run: "analysis-run",
  cancel: "analysis-cancel",
  status: "analysis-status",
  workerStatus: "worker-status",
  result: "analysis-result",
  rawEvidenceStatus: "raw-evidence-status",
  plot: "analysis-plot",
  windowSize: "analysis-spec-window-size",
} as const;

type WorkerProbeEvent = {
  type: "create" | "terminate";
  url: string;
  at: number;
};

declare global {
  interface Window {
    __THREEDENA_WORKER_EVENTS__?: WorkerProbeEvent[];
  }
}

/** Install before navigation so Worker construction/termination is observable. */
export async function installWorkerProbe(page: Page) {
  await page.addInitScript(() => {
    const events: WorkerProbeEvent[] = [];
    window.__THREEDENA_WORKER_EVENTS__ = events;
    const NativeWorker = window.Worker;

    window.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const url = String(args[0]);
        events.push({ type: "create", url, at: performance.now() });
        const worker = Reflect.construct(target, args) as Worker;
        const nativeTerminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          events.push({ type: "terminate", url, at: performance.now() });
          nativeTerminate();
        };
        return worker;
      },
    });
  });
}

export async function workerEvents(page: Page) {
  return page.evaluate(() => window.__THREEDENA_WORKER_EVENTS__ ?? []);
}

export async function uploadSmallRaw(page: Page) {
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

export async function loadSyntheticPreparedExchange(page: Page) {
  await page.getByTestId(testIds.preparedMode).click();
  await expect(page.getByTestId(testIds.workspace)).toHaveAttribute(
    "data-analysis-mode",
    "prepared",
  );
  await page.getByTestId(testIds.preparedFileInput).setInputFiles({
    name: "synthetic-prepared.ena3d.json",
    mimeType: "application/json",
    buffer: SYNTHETIC_PREPARED_BYTES,
  });
  await expect(page.getByTestId(testIds.preparedImportStatus)).toHaveAttribute(
    "data-state",
    "completed",
    { timeout: 30_000 },
  );
  const receipt = page.getByTestId(testIds.preparedReceipt);
  await expect(receipt).toHaveAttribute("data-source", "file");
  await expect(receipt).toHaveAttribute(
    "data-dataset-hash",
    SYNTHETIC_PREPARED_SHA256,
  );
  await expect(page.getByTestId(testIds.run)).toBeEnabled();
}

export function observeAnalysisTransport(page: Page) {
  const fetchOrXhr: string[] = [];
  const webSockets: string[] = [];
  let recording = false;

  page.on("request", (request) => {
    if (!recording) return;
    if (["fetch", "xhr"].includes(request.resourceType())) {
      const url = new URL(request.url());
      const headers = request.headers();
      const isNextRoutePrefetch = request.method() === "GET"
        && url.searchParams.has("_rsc")
        && headers["rsc"] === "1"
        && headers["next-router-prefetch"] === "1";
      // WebKit reports the module Worker's own same-origin Next.js chunk load
      // as `fetch`; Chromium and Firefox report it as a worker/script request.
      // Exempt only the exact immutable framework asset namespace and emitted
      // Worker chunk naming shape. Any application endpoint, cross-origin URL,
      // non-GET request, or Worker-issued data fetch remains observable.
      const isNextWorkerChunk = request.method() === "GET"
        && url.origin === new URL(page.url()).origin
        && /^\/_next\/static\/chunks\/_app-pages-browser_workers_[A-Za-z0-9_-]+_worker_ts\.js$/u.test(
          url.pathname,
        );
      if (isNextRoutePrefetch || isNextWorkerChunk) return;
      fetchOrXhr.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("websocket", (socket) => {
    const url = socket.url();
    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      // An unparseable socket URL is not a framework exemption.
    }
    // Next versions use one of these exact development-only HMR paths.
    // Product analysis must not own any socket.
    if (!["/_next/hmr", "/_next/webpack-hmr"].includes(pathname)) {
      webSockets.push(url);
    }
  });

  return {
    start() {
      recording = true;
    },
    assertNone() {
      expect(
        fetchOrXhr,
        "analysis must not issue fetch/XHR; CSV-to-result stays in the browser Worker",
      ).toEqual([]);
      expect(
        webSockets,
        "analysis must not open an application WebSocket",
      ).toEqual([]);
    },
  };
}

export async function expectOwnedResult(page: Page) {
  const result = page.getByTestId(testIds.result);
  const plot = page.getByTestId(testIds.plot);
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-dataset-hash", /^[a-f0-9]{8,}$/i);
  await expect(result).toHaveAttribute("data-spec-hash", /^[a-f0-9]{8,}$/i);
  await expect(result).toHaveAttribute("data-run-id", /\S+/);
  await expect(plot).toHaveAttribute("data-plotly-ready", "true");
  await expect(plot.locator(".js-plotly-plot")).toBeVisible();

  return {
    datasetHash: (await result.getAttribute("data-dataset-hash"))!,
    specHash: (await result.getAttribute("data-spec-hash"))!,
    runId: (await result.getAttribute("data-run-id"))!,
  };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page overflows horizontally (${overflow.scrollWidth}px > ${overflow.clientWidth}px)`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}
