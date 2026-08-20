import { afterEach, describe, expect, it } from "vitest";
import { readCurrentBuildId } from "@/lib/app-build-identity";
import { THREEDENA_APP_ID } from "@/lib/evidence-scope";

describe("readCurrentBuildId", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reads the server-rendered application/build identity without a fetch", async () => {
    const shell = document.createElement("div");
    shell.dataset.appId = THREEDENA_APP_ID;
    shell.dataset.buildId = "exact-build-123";
    shell.dataset.productStatus = "IMPLEMENTED_UNVERIFIED";
    document.body.append(shell);

    await expect(readCurrentBuildId()).resolves.toBe("exact-build-123");
  });

  it("fails closed for a missing or mismatched application identity", async () => {
    await expect(readCurrentBuildId()).rejects.toThrow(/different application/u);
    const shell = document.createElement("div");
    shell.dataset.appId = "other-app";
    shell.dataset.buildId = "build";
    shell.dataset.productStatus = "IMPLEMENTED_UNVERIFIED";
    document.body.append(shell);
    await expect(readCurrentBuildId()).rejects.toThrow(/different application/u);
  });
});
