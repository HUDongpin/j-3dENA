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

test("route navigation survives refresh and browser history", async ({ page }) => {
  await page.goto("/");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);

  await page.reload();
  await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/papers");
  await page.goBack();
  await expect(page).toHaveURL(/\/app$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/papers$/);
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
