#!/usr/bin/env node

/**
 * Deterministic, offline CycloneDX 1.5 generator for the reviewed production
 * lock graph. The document intentionally omits filesystem paths, registry
 * URLs, package payloads, and source/license contents.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UUID_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

export const RELEASE_SBOM_CONTRACT = "3dena.release-sbom.cyclonedx-1.5.v1";
export const SBOM_PROPERTY = Object.freeze({
  contract: "3dena:sbom:contract",
  graphSha256: "3dena:sbom:production-graph-sha256",
  licenseRationale: "3dena:license:disposition-rationale",
  licenseEvidence: "3dena:license:evidence",
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function uuidV5(name) {
  const bytes = createHash("sha1")
    .update(UUID_NAMESPACE)
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function npmPackagePurl(name, version) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("SBOM package name is missing");
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("SBOM package version is missing");
  }
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1 || slash === name.length - 1) {
      throw new Error("Scoped SBOM package name is invalid");
    }
    const namespace = encodeURIComponent(name.slice(0, slash));
    const packageName = encodeURIComponent(name.slice(slash + 1));
    return `pkg:npm/${namespace}/${packageName}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function cycloneDxLicense(expression) {
  if (/^[A-Za-z0-9][A-Za-z0-9.+-]*$/u.test(expression)) {
    return { license: { id: expression } };
  }
  return { expression };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

export function licenseEvidenceProperties(disposition) {
  const rationale = uniqueStrings(
    String(disposition?.rationale ?? "")
      .split("; ")
      .filter(Boolean),
  ).join("; ");
  const evidence = uniqueStrings(disposition?.sources ?? []).join("; ");
  if (!rationale || !evidence) {
    throw new Error("Every production component needs license rationale and evidence");
  }
  return [
    { name: SBOM_PROPERTY.licenseRationale, value: rationale },
    { name: SBOM_PROPERTY.licenseEvidence, value: evidence },
  ];
}

function graphSnapshot(graph, dispositions) {
  const components = [...graph.nodes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reference, node]) => {
      const disposition = dispositions.get(reference);
      if (disposition === undefined) {
        throw new Error("Production graph contains a package without a license disposition");
      }
      return {
        reference,
        name: node.name,
        version: node.version,
        optional: node.optional === true,
        license: disposition.expression,
        rationale: licenseEvidenceProperties(disposition)[0].value,
        evidence: licenseEvidenceProperties(disposition)[1].value,
      };
    });
  const dependencies = [graph.rootRef, ...graph.nodes.keys()]
    .filter((reference, index, values) => typeof reference === "string" && values.indexOf(reference) === index)
    .sort()
    .map((reference) => ({
      reference,
      dependsOn: [...(graph.edges.get(reference) ?? [])].sort(),
    }));
  return { rootRef: graph.rootRef, components, dependencies };
}

function isPrivateWorkspaceNode(node) {
  return node.paths.some((pathname) => !pathname.includes("node_modules/"));
}

export function createReleaseSbom({ graph, dispositions }) {
  if (
    graph?.rootRef === null ||
    typeof graph?.rootRef !== "string" ||
    !(graph.nodes instanceof Map) ||
    !(graph.edges instanceof Map) ||
    !(dispositions instanceof Map)
  ) {
    throw new Error("A complete production graph and disposition map are required");
  }
  const rootMetadata = graph.lock?.packages?.[""];
  if (
    rootMetadata === null ||
    typeof rootMetadata !== "object" ||
    typeof rootMetadata.name !== "string" ||
    typeof rootMetadata.version !== "string"
  ) {
    throw new Error("The production lock root identity is incomplete");
  }

  const snapshot = graphSnapshot(graph, dispositions);
  const snapshotJson = stableStringify(snapshot);
  const graphDigest = sha256(snapshotJson);
  const components = snapshot.components.map(({ reference }) => {
    const node = graph.nodes.get(reference);
    const disposition = dispositions.get(reference);
    const properties = licenseEvidenceProperties(disposition);
    if (isPrivateWorkspaceNode(node)) {
      properties.push({ name: "cdx:npm:package:private", value: "true" });
    }
    return {
      "bom-ref": reference,
      type: "library",
      name: node.name,
      version: node.version,
      scope: node.optional === true ? "optional" : "required",
      purl: npmPackagePurl(node.name, node.version),
      licenses: [cycloneDxLicense(disposition.expression)],
      properties: properties.sort((left, right) => left.name.localeCompare(right.name)),
    };
  });
  const dependencies = snapshot.dependencies.map(({ reference, dependsOn }) => ({
    ref: reference,
    dependsOn,
  }));

  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${uuidV5(`${RELEASE_SBOM_CONTRACT}:${graphDigest}`)}`,
    version: 1,
    metadata: {
      component: {
        "bom-ref": graph.rootRef,
        type: "application",
        name: rootMetadata.name,
        version: rootMetadata.version,
        scope: "required",
        purl: npmPackagePurl(rootMetadata.name, rootMetadata.version),
        licenses: [{ license: { id: "GPL-3.0-only" } }],
        properties: [
          { name: "cdx:npm:package:private", value: "true" },
          { name: SBOM_PROPERTY.contract, value: RELEASE_SBOM_CONTRACT },
          { name: SBOM_PROPERTY.graphSha256, value: graphDigest },
        ].sort((left, right) => left.name.localeCompare(right.name)),
      },
      properties: [
        { name: SBOM_PROPERTY.contract, value: RELEASE_SBOM_CONTRACT },
        { name: SBOM_PROPERTY.graphSha256, value: graphDigest },
      ],
    },
    components,
    dependencies,
  };
}

function safeRealpath(pathname) {
  return resolve(pathname);
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      if (!argv[index + 1]) throw new Error("--root requires a path");
      options.root = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--output") {
      if (!argv[index + 1]) throw new Error("--output requires a path");
      options.output = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/generate-release-sbom.mjs [options]",
          "",
          "Options:",
          "  --root <path>     repository root",
          "  --output <path>   write JSON to a selected path (stdout by default)",
          "",
        ].join("\n"),
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function runCli() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) {
      const {
        buildProductionDependencyGraph,
        inspectProductionDependencyLicenses,
        inspectWorkspaceManifests,
      } = await import("./verify-release-security.mjs");
      const workspace = inspectWorkspaceManifests({ root: options.root });
      const graph = buildProductionDependencyGraph({
        root: options.root,
        workspacePaths: workspace.evidence.workspacePaths,
      });
      const licenses = inspectProductionDependencyLicenses({ root: options.root, graph });
      if (!workspace.ok || !graph.ok || !licenses.ok) {
        throw new Error("Release SBOM input gates failed");
      }
      const document = createReleaseSbom({ graph, dispositions: licenses.dispositions });
      const json = `${JSON.stringify(document, null, 2)}\n`;
      if (options.output === null) {
        process.stdout.write(json);
      } else {
        writeFileSync(options.output, json, { flag: "w" });
        process.stderr.write("Wrote deterministic CycloneDX release SBOM.\n");
      }
    }
  } catch (error) {
    process.stderr.write(
      `Release SBOM generation failed with ${error?.constructor?.name ?? "Error"}.\n`,
    );
    process.exitCode = 1;
  }
}

if (safeRealpath(process.argv[1] ?? "") === safeRealpath(SCRIPT_PATH)) {
  // Do not use top-level await here: the CLI dynamically imports the verifier,
  // while the verifier imports this module's pure generator API.
  void runCli();
}
