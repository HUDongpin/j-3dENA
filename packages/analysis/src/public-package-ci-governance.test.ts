import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("public package CI source and artifact governance", () => {
  it("builds twice from detached source S and hands raw artifacts to an ID-bound consumer", async () => {
    const workflow = await readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const producer = workflow.match(/  public-package-producer:[\s\S]*?(?=\n  public-package-consumer:)/u)?.[0] ?? "";
    const consumer = workflow.match(/  public-package-consumer:[\s\S]*?(?=\n  [a-z][a-z-]+:|$)/u)?.[0] ?? "";
    expect(producer).toContain("github.event.pull_request.head.sha || github.sha");
    expect(producer).toContain("git symbolic-ref -q HEAD");
    expect(producer).toContain("compare-public-package-trees.mjs");
    expect(producer.match(/archive: false/gu)).toHaveLength(2);
    expect(producer.match(/if-no-files-found: error/gu)).toHaveLength(2);
    expect(producer.match(/overwrite: false/gu)).toHaveLength(2);
    expect(consumer).toContain("artifact-ids:");
    expect(consumer).not.toMatch(/\n\s+name:\s+public-package/u);
    expect(consumer).toContain("^[1-9][0-9]*$");
    expect(consumer).toContain("sha256sum");
    expect(consumer).toContain("--tarball");
    expect(consumer).toContain("--receipt");
    expect(consumer).toContain("github-token: ${{ github.token }}");
    expect(consumer).toContain("repository: ${{ github.repository }}");
    expect(consumer).toContain("run-id: ${{ github.run_id }}");
  });
});
