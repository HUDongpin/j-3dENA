import { expect, type Page } from "@playwright/test";

export const PRODUCT_ROUTES = ["/", "/app", "/papers", "/team", "/about"] as const;

export const testIds = {
  appShell: "app-shell",
  routeMain: "route-main",
  rawFileInput: "raw-file-input",
  run: "analysis-run",
  cancel: "analysis-cancel",
  status: "analysis-status",
  workerStatus: "worker-status",
  result: "analysis-result",
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

export function observeAnalysisTransport(page: Page) {
  const fetchOrXhr: string[] = [];
  const webSockets: string[] = [];
  let recording = false;

  page.on("request", (request) => {
    if (!recording) return;
    if (["fetch", "xhr"].includes(request.resourceType())) {
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
