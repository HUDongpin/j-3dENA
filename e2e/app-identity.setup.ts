import { expect, test } from "@playwright/test";

const EXPECTED_APP_ID = "j-3dena-next";
const EXPECTED_SCHEMA_VERSION = "3dena.web-build-info.v2";
const EXPECTED_PRODUCT_STATUS = "IMPLEMENTED_UNVERIFIED";
const EXPECTED_EVIDENCE_SCOPE_VERSION =
  "3dena.small-raw-evidence-scope.v2";

test("acceptance target exposes the expected application and build identity", async ({
  request,
}) => {
  const response = await request.get("/build-info", {
    headers: { Accept: "application/json" },
  });
  expect(
    response.status(),
    "Playwright must target the j-3dENA application, not an unknown process on the configured port",
  ).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const identity = (await response.json()) as {
    schemaVersion?: string;
    appId?: string;
    role?: string;
    webBuildId?: string;
    execution?: { mode?: string; production?: boolean };
    activeBuildApproval?: unknown;
    productStatus?: string;
    evidenceScopeVersion?: string;
  };
  expect(identity).toMatchObject({
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    appId: EXPECTED_APP_ID,
    role: "web",
    productStatus: EXPECTED_PRODUCT_STATUS,
    evidenceScopeVersion: EXPECTED_EVIDENCE_SCOPE_VERSION,
  });
  expect(identity.webBuildId).toMatch(/\S+/u);

  const expectedBuildId = process.env.PLAYWRIGHT_EXPECTED_BUILD_ID;
  if (expectedBuildId) {
    expect(
      identity.webBuildId,
      "The server is j-3dENA, but it is not the exact build requested by the acceptance run",
    ).toBe(expectedBuildId);
  }
});
