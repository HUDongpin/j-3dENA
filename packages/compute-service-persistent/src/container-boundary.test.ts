import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function deployFile(name: string): string {
  return readFileSync(new URL(`../deploy/${name}`, import.meta.url), "utf8");
}

describe("compute container boundary", () => {
  it("requires a reviewed immutable base, tini, non-root runtime, and narrow bundle copy", () => {
    const dockerfile = deployFile("Dockerfile");
    expect(dockerfile).toContain("ARG NODE_BASE_IMAGE");
    expect(dockerfile).toContain("FROM ${NODE_BASE_IMAGE}");
    expect(dockerfile).not.toMatch(/^FROM\s+[^$].*:[^@\s]+\s*$/mu);
    expect(dockerfile).toContain("test -x /sbin/tini");
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("chmod -R a-w /app");
    expect(dockerfile).toContain("compute-runtime.mjs");
    expect(dockerfile).toContain("scientific-worker-entry.mjs");
    expect(dockerfile).toContain("BUILD_MANIFEST_PATH=/app/build-manifest.json");
    expect(dockerfile).toContain("SCIENTIFIC_WORKER_ENTRY_PATH=/app/scientific-worker-entry.mjs");
    expect(dockerfile).not.toMatch(/COPY\s+\.\s+/u);
    expect(dockerfile).not.toMatch(/apt-get|apk add|dnf install|Rscript|rENA|Shiny/iu);
    expect(dockerfile).toContain("/readyz");
  });

  it("denies the dirty repository and admits only the frozen build inputs", () => {
    const dockerignore = readFileSync(new URL("../../../.dockerignore", import.meta.url), "utf8");
    expect(dockerignore.trimStart()).toMatch(/^#/u);
    expect(dockerignore).toMatch(/^\*\*$/mu);
    expect(dockerignore).toContain("!output/compute-service/compute-runtime.mjs");
    expect(dockerignore).toContain("!output/compute-service/scientific-worker-entry.mjs");
    expect(dockerignore).toContain("!output/compute-service/build-manifest.json");
    expect(dockerignore).toContain("!packages/compute-service-persistent/deploy/Dockerfile");
    expect(dockerignore).toContain("!packages/compute-service-persistent/deploy/entrypoint.sh");
    expect(dockerignore).not.toMatch(/!oracle|!evidence|!apps\/|!\.git|!.*test-fixtures/iu);
  });

  it("defines distinct api/worker process groups and bounded candidate VMs", () => {
    const fly = deployFile("fly.toml");
    expect(fly).toContain('[processes]');
    expect(fly).toContain('api = "api"');
    expect(fly).toContain('worker = "worker"');
    expect(fly).toContain('processes = ["api"]');
    expect(fly).toContain('processes = ["worker"]');
    expect(fly).toContain('path = "/readyz"');
    expect(fly).toContain('swap_size_mb = 0');
    expect(fly).not.toMatch(/^\s*app\s*=/mu);
    expect(fly).not.toMatch(/^\s*primary_region\s*=/mu);
  });

  it("hard-fails entrypoint resource and filesystem checks before Node", () => {
    const entrypoint = deployFile("entrypoint.sh");
    expect(entrypoint).toContain("set -eu");
    expect(entrypoint).toContain("umask 077");
    expect(entrypoint).toContain('ulimit -n "${MAX_OPEN_FILES}"');
    expect(entrypoint).toContain('ulimit -u "${MAX_PROCESSES}"');
    expect(entrypoint).toContain("test ! -w /app");
    expect(entrypoint).toContain('test -w "${TMPDIR}"');
    expect(entrypoint).toContain("exec /sbin/tini -- node /app/compute-runtime.mjs");
  });
});
