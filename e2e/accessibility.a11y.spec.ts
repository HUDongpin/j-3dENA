import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  expectOwnedResult,
  installWorkerProbe,
  loadSyntheticPreparedExchange,
  PRODUCT_ROUTES,
  testIds,
  uploadSmallRaw,
  workerEvents,
} from "./helpers/runtime-contract";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

async function expectNoBlockingAxeViolations(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter(({ impact }) =>
    ["serious", "critical"].includes(impact ?? ""),
  );
  expect(
    blocking,
    [
      `${state} has serious or critical axe violations:`,
      ...blocking.map(
        ({ id, impact, nodes }) =>
          `${impact}: ${id} (${nodes.length} affected node(s))`,
      ),
    ].join("\n"),
  ).toEqual([]);
}

for (const viewport of VIEWPORTS) {
  test(`/app synthetic prepared result is accessible and contained at ${viewport.name} @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installWorkerProbe(page);
    await page.goto("/app");
    await loadSyntheticPreparedExchange(page);

    await page.getByTestId(testIds.run).click();
    await expect(page.getByTestId(testIds.status)).toHaveAttribute(
      "data-state",
      "completed",
      { timeout: 30_000 },
    );
    await expectOwnedResult(page);
    await expect(page.getByTestId(testIds.result)).toHaveAttribute(
      "data-source-kind",
      "prepared-exchange",
    );
    expect(
      (await workerEvents(page)).filter(({ type }) => type === "create").length,
      "prepared validation and reduction must construct browser Workers before rendering Plotly",
    ).toBeGreaterThanOrEqual(2);

    const networksTab = page.getByRole("tab", { name: "Networks" });
    const networksPanel = page.getByRole("tabpanel", { name: "Networks" });
    const plot = page.getByTestId(testIds.plot);
    await expect(plot).toHaveAttribute("tabindex", "0");
    await networksTab.focus();
    await page.keyboard.press("Tab");
    await expect(networksPanel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(plot).toBeFocused();
    await expectRegionInsideViewport(plot, "prepared Plotly panel");
    await expectRegionInsideViewport(
      plot.locator(".js-plotly-plot"),
      "prepared Plotly canvas",
    );

    const statisticsTab = page.getByRole("tab", { name: "Stats" });
    await statisticsTab.click();
    const statisticsPanel = page.getByRole("tabpanel", { name: "Stats" });
    await statisticsTab.focus();
    await page.keyboard.press("Tab");
    await expect(statisticsPanel).toBeFocused();
    await expect(page.getByTestId("prepared-statistics-run")).toBeEnabled();
    await expectRegionInsideViewport(statisticsPanel, "prepared Stats panel");
    await expectNoBlockingAxeViolations(
      page,
      `${viewport.name} prepared Stats controls`,
    );

    const trajectoryTab = page.getByRole("tab", { name: "Trajectory" });
    await trajectoryTab.click();
    const trajectoryPanel = page.getByRole("tabpanel", { name: "Trajectory" });
    const trajectoryPlot = page.getByTestId("prepared-trajectory-plot");
    const table = page.getByTestId("prepared-centroid-table");
    await trajectoryTab.focus();
    await page.keyboard.press("Tab");
    await expect(trajectoryPanel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(trajectoryPlot).toBeFocused();
    // Plotly owns internal tab stops that vary by renderer/version. The
    // product contract is that the table becomes focusable only after its
    // Trajectory panel is active, not that it immediately follows Plotly.
    await table.focus();
    await expect(table).toBeFocused();
    await expect(table).toHaveAttribute("tabindex", "0");
    await expectRegionInsideViewport(
      trajectoryPlot,
      "prepared trajectory Plotly panel",
    );
    await expectRegionInsideViewport(table, "prepared centroid table");
    await expectDocumentWithinViewport(
      page,
      viewport.width,
      `${viewport.name} synthetic prepared result`,
    );
    await expectNoBlockingAxeViolations(
      page,
      `${viewport.name} synthetic prepared result`,
    );
  });
}

async function expectDocumentWithinViewport(
  page: Page,
  expectedViewportWidth: number,
  state: string,
) {
  const widths = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(widths.viewportWidth).toBe(expectedViewportWidth);
  expect(
    widths.documentScrollWidth,
    `${state} document width ${widths.documentScrollWidth}px exceeds the ${widths.viewportWidth}px viewport`,
  ).toBeLessThanOrEqual(widths.viewportWidth);
  expect(
    widths.bodyScrollWidth,
    `${state} body width ${widths.bodyScrollWidth}px exceeds the ${widths.viewportWidth}px viewport`,
  ).toBeLessThanOrEqual(widths.viewportWidth);
}

async function expectRegionInsideViewport(
  region: Locator,
  label: string,
) {
  const bounds = await region.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(bounds.width, `${label} must have a rendered width`).toBeGreaterThan(0);
  expect(
    bounds.left,
    `${label} begins outside the viewport`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    bounds.right,
    `${label} ends at ${bounds.right}px beyond the ${bounds.viewportWidth}px viewport`,
  ).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.clientWidth, `${label} must own its visible width`).toBeGreaterThan(
    0,
  );
  expect(bounds.scrollWidth, `${label} reports an invalid scroll width`).toBeGreaterThan(
    0,
  );
}

for (const viewport of VIEWPORTS) {
  for (const route of PRODUCT_ROUTES) {
    test(`${route} has no serious or critical axe violations at ${viewport.name} @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
      await expectNoBlockingAxeViolations(page, `${route} initial state`);
    });
  }
}

for (const viewport of VIEWPORTS) {
  test(`/app completed Worker result is accessible and contained at ${viewport.name} @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installWorkerProbe(page);
    await page.goto("/app");
    await uploadSmallRaw(page);

    await page.getByTestId(testIds.run).click();
    await expect(page.getByTestId(testIds.status)).toHaveAttribute(
      "data-state",
      "completed",
      { timeout: 30_000 },
    );
    await expectOwnedResult(page);
    expect(
      (await workerEvents(page)).filter(({ type }) => type === "create").length,
      "completed analysis must construct a browser Worker before rendering Plotly",
    ).toBeGreaterThanOrEqual(1);

    const networksTab = page.getByRole("tab", { name: "Networks" });
    const networksPanel = page.getByRole("tabpanel", { name: "Networks" });
    const plotPanel = page.getByTestId(testIds.plot);
    await networksTab.focus();
    await page.keyboard.press("Tab");
    await expect(networksPanel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(plotPanel).toBeFocused();
    await expect(plotPanel).toHaveAttribute("tabindex", "0");
    await expectRegionInsideViewport(plotPanel, "Plotly tab panel");
    await expectRegionInsideViewport(
      plotPanel.locator(".js-plotly-plot"),
      "Plotly canvas",
    );
    await expectDocumentWithinViewport(
      page,
      viewport.width,
      `${viewport.name} completed network result`,
    );
    await expectNoBlockingAxeViolations(
      page,
      `${viewport.name} completed network result`,
    );

    const statisticsTab = page.getByRole("tab", { name: "Stats" });
    await statisticsTab.click();
    const statisticsPanel = page.getByRole("tabpanel", { name: "Stats" });
    await statisticsTab.focus();
    await page.keyboard.press("Tab");
    await expect(statisticsPanel).toBeFocused();
    await expect(page.getByTestId("raw-statistics-run")).toBeEnabled();
    await expectRegionInsideViewport(statisticsPanel, "raw Stats panel");
    await expectNoBlockingAxeViolations(
      page,
      `${viewport.name} raw Stats controls`,
    );

    const trajectoryTab = page.getByRole("tab", { name: "Trajectory" });
    await trajectoryTab.click();
    const trajectoryPanel = page.getByRole("tabpanel", { name: "Trajectory" });
    const trajectoryPlot = page.getByTestId("trajectory-plot");
    const unitTable = page.getByRole("region", {
      name: "Unit coordinate table",
    });
    const centroidTable = page.getByRole("region", {
      name: "Group-time centroid table",
    });
    await trajectoryTab.focus();
    await expect(trajectoryTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(trajectoryPanel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(trajectoryPlot).toBeFocused();
    await unitTable.focus();
    await expect(unitTable).toBeFocused();
    await centroidTable.focus();
    await expect(centroidTable).toBeFocused();
    await expectRegionInsideViewport(trajectoryPanel, "trajectory result panel");
    await expectRegionInsideViewport(trajectoryPlot, "trajectory Plotly panel");
    await expectRegionInsideViewport(unitTable, "unit coordinate table");
    await expectRegionInsideViewport(
      centroidTable,
      "group-time centroid table",
    );
    await expectDocumentWithinViewport(
      page,
      viewport.width,
      `${viewport.name} completed trajectory result`,
    );
    await expectNoBlockingAxeViolations(
      page,
      `${viewport.name} completed trajectory result`,
    );
  });
}
