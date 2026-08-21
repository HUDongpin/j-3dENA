import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  PRODUCT_ROUTES,
  testIds,
} from "./helpers/runtime-contract";

for (const route of PRODUCT_ROUTES) {
  test(`${route} renders the shared application shell`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok(), `${route} should return a successful document`).toBe(true);
    const appShell = page.getByTestId(testIds.appShell);
    await expect(appShell).toBeVisible();
    await expect(appShell).toHaveAttribute("data-app-id", "j-3dena-next");
    await expect(appShell).toHaveAttribute(
      "data-product-status",
      "IMPLEMENTED_UNVERIFIED",
    );
    await expect(page.getByTestId("product-status")).toContainText(
      "IMPLEMENTED_UNVERIFIED",
    );
    await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", /\S+/);
    await expectNoHorizontalOverflow(page);
  });
}

test("route navigation survives refresh and browser history", async ({
  browserName,
  page,
}) => {
  await page.goto("/app", { waitUntil: "commit" });
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);

  await page.reload({ waitUntil: "commit" });
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/papers", { waitUntil: "commit" });
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
  // Firefox can cancel its previous document load after the history entry has
  // already committed (`NS_BINDING_CANCELLED_OLD_LOAD`). Waiting for `load`
  // turns that engine-level cancellation into a Playwright retry even though
  // the history transition itself succeeded. Bind the operation to the
  // committed history entry, then prove that the destination shell rendered.
  await page.goBack({ waitUntil: "commit" });
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
  try {
    await page.goForward({ waitUntil: "commit" });
  } catch (error) {
    // The destination may be fully committed and rendered even though Gecko
    // reports cancellation of the superseded document load. Only accept that
    // exact Firefox signal; the URL and rendered-shell assertions below remain
    // the authoritative history outcome.
    expect(browserName).toBe("firefox");
    expect(String(error)).toContain("NS_BINDING_CANCELLED_OLD_LOAD");
  }
  await expect(page).toHaveURL(/\/papers$/);
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const) {
  test(`/app has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await expect(page.getByTestId(testIds.appShell)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
