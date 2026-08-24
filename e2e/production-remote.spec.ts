import { expect, test } from "@playwright/test";

test.skip(
  process.env.E2E_PRODUCTION_REMOTE !== "1",
  "Runs only against an optimized production build with no remote configuration.",
);

test("optimized production fails closed instead of exposing local Workers", async ({
  page,
}) => {
  const workerUrls: string[] = [];
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        (window as unknown as { __remoteProductionWorkers?: string[] })
          .__remoteProductionWorkers ??= [];
        (window as unknown as { __remoteProductionWorkers: string[] })
          .__remoteProductionWorkers.push(String(args[0]));
        return Reflect.construct(target, args) as Worker;
      },
    });
  });

  await page.goto("/app");
  await expect(page.getByTestId("analysis-workspace")).toHaveAttribute(
    "data-execution-mode",
    "remote",
  );
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute(
    "data-state",
    "blocked",
  );
  await expect(page.getByTestId("remote-runtime-status")).toContainText(
    "NEXT_PUBLIC_3DENA_COMPUTE_BASE_URL",
  );
  await expect(page.getByTestId("remote-file-input")).toBeDisabled();
  await expect(page.getByTestId("raw-file-input")).toHaveCount(0);
  workerUrls.push(...await page.evaluate(() => (
    (window as unknown as { __remoteProductionWorkers?: string[] })
      .__remoteProductionWorkers ?? []
  )));
  expect(workerUrls).toEqual([]);
});
