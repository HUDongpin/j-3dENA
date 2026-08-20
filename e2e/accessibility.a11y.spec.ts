import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { PRODUCT_ROUTES, testIds } from "./helpers/runtime-contract";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const) {
  for (const route of PRODUCT_ROUTES) {
    test(`${route} has no serious or critical axe violations at ${viewport.name} @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await expect(page.getByTestId(testIds.routeMain)).toBeVisible();
      const result = await new AxeBuilder({ page }).analyze();
      const blocking = result.violations.filter(({ impact }) =>
        ["serious", "critical"].includes(impact ?? ""),
      );
      expect(
        blocking,
        blocking
          .map(
            ({ id, impact, nodes }) =>
              `${impact}: ${id} (${nodes.length} affected node(s))`,
          )
          .join("\n"),
      ).toEqual([]);
    });
  }
}
