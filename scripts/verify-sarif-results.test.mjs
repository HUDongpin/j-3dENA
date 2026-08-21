import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectSarifResults } from "./verify-sarif-results.mjs";

async function fixture(resultCount) {
  const root = await mkdtemp(join(tmpdir(), "3dena-sarif-gate-"));
  const path = join(root, "result.sarif");
  await writeFile(path, `${JSON.stringify({
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "fixture" } },
      results: Array.from({ length: resultCount }, (_, index) => ({ ruleId: `RULE-${index}` })),
    }],
  })}\n`);
  return { root, path };
}

test("accepts a well-formed zero-result SARIF document", async () => {
  const { path } = await fixture(0);
  const result = await inspectSarifResults({ path, maximumResults: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.resultCount, 0);
});

test("fails closed when the result count exceeds the approved maximum", async () => {
  const { path } = await fixture(2);
  const result = await inspectSarifResults({ path, maximumResults: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.resultCount, 2);
});

test("accepts a directory only when it contains SARIF evidence", async () => {
  const { root } = await fixture(0);
  await mkdir(join(root, "empty"));
  await assert.rejects(
    inspectSarifResults({ path: join(root, "empty") }),
    /contains no SARIF files/u,
  );
});
