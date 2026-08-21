import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createReleaseSbom } from "./generate-release-sbom.mjs";
import {
  buildProductionDependencyGraph,
  generateCycloneDxSbom,
  inspectProductionDependencyLicenses,
  inspectPublicPackageLayout,
  inspectWorkspaceManifests,
  validateCycloneDxSbom,
} from "./verify-release-security.mjs";

function temporaryRoot(prefix = "3dena-release-security-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(pathname, value) {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`);
}

function repositoryFixture() {
  const root = temporaryRoot();
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  mkdirSync(join(root, "node_modules", "legacy-license"), { recursive: true });
  mkdirSync(join(root, "node_modules", "file-license"), { recursive: true });

  writeJson(join(root, "package.json"), {
    name: "fixture-root",
    version: "1.0.0",
    private: true,
    license: "GPL-3.0-only",
    workspaces: ["packages/*"],
  });
  writeJson(join(root, "packages", "core", "package.json"), {
    name: "@3dena/core",
    version: "1.0.0",
    private: true,
    license: "GPL-3.0-only",
    dependencies: {
      "file-license": "1.0.0",
      "legacy-license": "1.0.0",
    },
  });
  writeJson(join(root, "node_modules", "legacy-license", "package.json"), {
    name: "legacy-license",
    version: "1.0.0",
    licenses: [{ type: "MIT", url: "https://example.invalid/license" }],
  });
  writeJson(join(root, "node_modules", "file-license", "package.json"), {
    name: "file-license",
    version: "1.0.0",
  });
  writeFileSync(
    join(root, "node_modules", "file-license", "License"),
    [
      "MIT License",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND.",
      "",
    ].join("\n"),
  );
  writeJson(join(root, "package-lock.json"), {
    name: "fixture-root",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture-root",
        version: "1.0.0",
        license: "GPL-3.0-only",
        workspaces: ["packages/*"],
      },
      "packages/core": {
        name: "@3dena/core",
        version: "1.0.0",
        license: "GPL-3.0-only",
        dependencies: {
          "file-license": "1.0.0",
          "legacy-license": "1.0.0",
        },
      },
      "node_modules/file-license": { version: "1.0.0" },
      "node_modules/legacy-license": { version: "1.0.0" },
    },
  });
  return root;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function publicPackageFixture() {
  const root = temporaryRoot("3dena-public-package-");
  const directory = join(root, "dist", "package");
  mkdirSync(directory, { recursive: true });
  const license = "GNU GENERAL PUBLIC LICENSE Version 3\n";
  const sourceMap = '{"version":3,"sources":["source.ts"],"sourcesContent":["export {}"],"mappings":""}\n';
  writeFileSync(join(root, "LICENSE"), license);
  writeFileSync(join(directory, "LICENSE"), license);
  writeFileSync(join(directory, "README.md"), "# Public facade\n");
  writeFileSync(
    join(directory, "THIRD_PARTY_NOTICES.md"),
    "jena-js GPL-3.0-only\nSheetJS Apache-2.0\n",
  );
  writeFileSync(join(directory, "index.d.ts"), "export declare const ok: true;\n");
  writeFileSync(join(directory, "index.js"), "export const ok = true;\n");
  writeFileSync(join(directory, "index.js.map"), sourceMap);
  writeJson(join(directory, "package.json"), {
    name: "@3dena/analysis",
    version: "0.1.0",
    type: "module",
    license: "GPL-3.0-only",
    exports: {
      ".": { types: "./index.d.ts", import: "./index.js" },
    },
    publishConfig: { access: "public", provenance: true },
  });
  writeJson(join(directory, "PROVENANCE.json"), {
    package: { name: "@3dena/analysis", version: "0.1.0" },
    artifacts: { indexJsMapSha256: sha256(sourceMap) },
  });
  return { root, directory };
}

function sbomFixture() {
  const rootRef = "fixture-root@1.0.0";
  const workspaceRef = "@3dena/core@1.0.0";
  const dependencyRef = "legacy-license@1.0.0";
  const graph = {
    rootRef,
    lock: {
      packages: {
        "": { name: "fixture-root", version: "1.0.0" },
      },
    },
    nodes: new Map([
      [
        workspaceRef,
        {
          ref: workspaceRef,
          name: "@3dena/core",
          version: "1.0.0",
          paths: ["packages/core"],
          optional: false,
        },
      ],
      [
        dependencyRef,
        {
          ref: dependencyRef,
          name: "legacy-license",
          version: "1.0.0",
          paths: ["node_modules/legacy-license"],
          optional: false,
        },
      ],
    ]),
    edges: new Map([
      [rootRef, new Set([workspaceRef])],
      [workspaceRef, new Set([dependencyRef])],
      [dependencyRef, new Set()],
    ]),
  };
  const dispositions = new Map([
    [
      workspaceRef,
      {
        expression: "GPL-3.0-only",
        rationale: "project-selected GPL-3.0-only distribution boundary",
        sources: ["package-lock:license"],
      },
    ],
    [
      dependencyRef,
      {
        expression: "MIT",
        rationale: "permissive MIT; preserve copyright and permission notice",
        sources: ["package-manifest:license"],
      },
    ],
  ]);
  const sbom = createReleaseSbom({ graph, dispositions });
  return { graph, dispositions, sbom, workspaceRef, dependencyRef };
}

test("all source workspace manifests remain private and GPL-3.0-only", () => {
  const root = repositoryFixture();
  const result = inspectWorkspaceManifests({ root });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.evidence.workspacePaths, ["packages/core"]);

  writeJson(join(root, "packages", "core", "package.json"), {
    name: "@3dena/core",
    version: "1.0.0",
    private: false,
    license: "MIT",
    publishConfig: { access: "public" },
  });
  const rejected = inspectWorkspaceManifests({ root });
  assert.equal(rejected.ok, false);
  assert.deepEqual(
    new Set(rejected.findings.map(({ rule }) => rule)),
    new Set([
      "workspace-must-be-private",
      "workspace-publication-bypass",
      "workspace-license-drift",
    ]),
  );
});

test("production licenses accept legacy declarations and reviewed License files", () => {
  const root = repositoryFixture();
  const workspace = inspectWorkspaceManifests({ root });
  const graph = buildProductionDependencyGraph({
    root,
    workspacePaths: workspace.evidence.workspacePaths,
  });
  assert.equal(graph.ok, true, JSON.stringify(graph.findings, null, 2));
  const result = inspectProductionDependencyLicenses({ root, graph });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.productionPackages, 3);
  assert.equal(result.evidence.disposedPackages, 3);
  assert.equal(result.dispositions.get("legacy-license@1.0.0").expression, "MIT");
  assert.equal(result.dispositions.get("file-license@1.0.0").expression, "MIT");
});

test("unknown production licenses fail closed without printing license content", () => {
  const root = repositoryFixture();
  writeJson(join(root, "node_modules", "legacy-license", "package.json"), {
    name: "legacy-license",
    version: "1.0.0",
    license: "Mystery-1.0",
    privateResearchToken: "must-not-appear",
  });
  const graph = buildProductionDependencyGraph({ root });
  const result = inspectProductionDependencyLicenses({ root, graph });
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ path, rule }) =>
        path.endsWith("node_modules/legacy-license") &&
        rule === "unknown-production-license",
    ),
  );
  assert.doesNotMatch(JSON.stringify(result.findings), /must-not-appear/u);
});

test("public layout accepts only a root-export, provenance-bound facade", () => {
  const { root, directory } = publicPackageFixture();
  const result = inspectPublicPackageLayout({ root, packageDirectory: directory });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("public layout rejects local dependencies, extra exports, and private trees", () => {
  const { root, directory } = publicPackageFixture();
  const manifestPath = join(directory, "package.json");
  const manifest = {
    name: "@3dena/analysis",
    version: "0.1.0",
    type: "module",
    license: "GPL-3.0-only",
    exports: { ".": "./index.js", "./internal": "./internal.js" },
    dependencies: { "@3dena/internal": "workspace:*", local: "file:../local" },
    publishConfig: { access: "public", provenance: true },
  };
  writeJson(manifestPath, manifest);
  mkdirSync(join(directory, "fixtures"), { recursive: true });
  mkdirSync(join(directory, "node_modules", "private-runtime"), { recursive: true });
  writeFileSync(join(directory, "fixtures", "raw-private.csv"), "private\n");
  writeFileSync(
    join(directory, "node_modules", "private-runtime", "index.js"),
    "export {};\n",
  );
  const result = inspectPublicPackageLayout({ root, packageDirectory: directory });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("non-root-public-export"));
  assert.ok(rules.has("public-runtime-edge"));
  assert.ok(rules.has("public-local-protocol"));
  assert.ok(rules.has("private-public-artifact"));
});

test("CycloneDX generation wrapper is offline-testable and never writes an artifact", () => {
  const root = temporaryRoot("3dena-sbom-wrapper-");
  const fakeNpm = join(root, "fake-npm.mjs");
  writeFileSync(
    fakeNpm,
    [
      "#!/usr/bin/env node",
      "const expected = ['sbom', '--omit=dev', '--package-lock-only', '--sbom-format=cyclonedx'];",
      "if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(9);",
      "if (process.env.npm_config_offline !== 'true') process.exit(8);",
      "process.stdout.write(JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, cwd: process.cwd() }));",
      "",
    ].join("\n"),
  );
  chmodSync(fakeNpm, 0o755);
  const generated = generateCycloneDxSbom({ root, npmCli: fakeNpm });
  assert.equal(generated.bomFormat, "CycloneDX");
  assert.equal(basename(generated.cwd), basename(root));
});

test("CycloneDX validator accepts a complete production-only graph", () => {
  const fixture = sbomFixture();
  const result = validateCycloneDxSbom(fixture);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.components, 2);
  assert.equal(result.evidence.dependencies, 3);
});

test("release SBOM generation is deterministic and omits local filesystem paths", () => {
  const fixture = sbomFixture();
  const first = createReleaseSbom(fixture);
  const second = createReleaseSbom(fixture);
  assert.deepEqual(first, second);
  assert.match(
    first.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /\/Volumes\/|\/Users\/|node_modules\//u);
});

test("CycloneDX validator rejects missing components, edges, and unknown licenses", () => {
  const fixture = sbomFixture();
  fixture.sbom.components = fixture.sbom.components.filter(
    (component) => component["bom-ref"] !== fixture.dependencyRef,
  );
  fixture.sbom.dependencies.find(({ ref }) => ref === fixture.workspaceRef).dependsOn = [];
  fixture.sbom.components[0].licenses = [{ license: { id: "Mystery-1.0" } }];
  fixture.sbom.components.push({
    "bom-ref": "dev-only@1.0.0",
    type: "library",
    name: "dev-only",
    version: "1.0.0",
    scope: "excluded",
    purl: "pkg:npm/dev-only@1.0.0",
    licenses: [{ license: { id: "MIT" } }],
  });
  const result = validateCycloneDxSbom(fixture);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("missing-production-component"));
  assert.ok(rules.has("missing-production-edge"));
  assert.ok(rules.has("unknown-sbom-license"));
  assert.ok(rules.has("non-production-sbom-component"));
  assert.ok(rules.has("invalid-production-scope"));
});

test("raw npm SBOM regression: every omitted reachable package remains a release blocker", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const workspace = inspectWorkspaceManifests({ root });
  const graph = buildProductionDependencyGraph({
    root,
    workspacePaths: workspace.evidence.workspacePaths,
  });
  const licenses = inspectProductionDependencyLicenses({ root, graph });
  const rawNpmSbom = generateCycloneDxSbom({ root });
  const result = validateCycloneDxSbom({
    sbom: rawNpmSbom,
    graph,
    dispositions: licenses.dispositions,
  });
  const omitted = result.findings.filter(
    ({ rule }) => rule === "missing-production-component",
  );
  const rawComponentReferences = new Set(
    (rawNpmSbom.components ?? []).map((component) => component["bom-ref"]),
  );
  const expectedOmittedReferences = [...graph.nodes.keys()]
    .filter((reference) => !rawComponentReferences.has(reference))
    .sort();
  const reportedOmittedReferences = omitted
    .map(({ detail }) => {
      const match = detail.match(/"([^"]+)"/u);
      return match?.[1] ?? "";
    })
    .sort();
  assert.deepEqual(reportedOmittedReferences, expectedOmittedReferences);
  assert.ok(expectedOmittedReferences.length > 0);
  assert.ok(omitted.some(({ detail }) => detail.includes('"react@19.2.4"')));
  assert.ok(omitted.some(({ detail }) => detail.includes('"react-dom@19.2.4"')));
});
