import type { RunOwner } from "@/lib/worker-protocol";

export const THREEDENA_APP_ID = "j-3dena-next" as const;
export const BUILD_INFO_SCHEMA_VERSION = "3dena.web-build-info.v2" as const;
export const PRODUCT_STATUS = "IMPLEMENTED_UNVERIFIED" as const;
export const RAW_EVIDENCE_SCOPE_VERSION =
  "3dena.small-raw-evidence-scope.v2" as const;

/**
 * Candidate evidence is bound to exact input bytes, the complete UI mapping,
 * an explicit application build identity, and the frozen numerical/runtime
 * contract. A display name such as `small-raw.csv` is deliberately not
 * evidence.
 */
export const SMALL_RAW_PARITY_BINDING = Object.freeze({
  fixtureId: "small-raw-rena-0.2.7-accumulated-back4",
  datasetSha256:
    "163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16",
  specificationSha256:
    "cb6102aa7f0905bb4e2510e8c3cb5cd3871763f1c855eaeb1e619fc1e9b5c10d",
  resultSchemaVersion: "3dena.analysis-result.v1",
  adapter: "@3dena/analysis",
  adapterVersion: "0.1.0",
  jenaPackage: "jena-js",
  jenaVersion: "0.6.2",
  jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
  parityContract: "3dena.parity-contract.v1",
  legacyGoldenContract: "legacy-application-golden-v1",
  legacyGoldenStatus: "not-assessed",
  buildIdentityPolicy: "explicit-non-development-build-v1",
  axes: ["SVD1", "SVD2", "SVD3"] as const,
  resolvedConfig: {
    model: "AccumulatedTrajectory",
    window: "MovingStanzaWindow",
    weightBy: "binary",
    windowSizeBack: 4,
    windowSizeForward: 0,
    centerAlignToOrigin: true,
  },
  trajectorySpace: "analysis-result-rotation",
  cohortPolicy: "available",
});

interface RawEvidenceResult {
  schemaVersion: string;
  axes: readonly string[];
  trajectory?: {
    space: string;
    cohortPolicy: string;
  };
  provenance: {
    adapter: string;
    adapterVersion: string;
    jenaPackage?: string;
    jenaVersion: string;
    jenaCommit?: string;
    parityContract?: string;
    legacyGoldenContract?: string;
    legacyGoldenStatus?: string;
    resolvedConfig: {
      model: string;
      window: string;
      weightBy: string;
      windowSizeBack: number;
      windowSizeForward: number;
      centerAlignToOrigin: boolean;
    };
  };
}

export type RawEvidenceMismatch =
  | "dataset"
  | "specification"
  | "build-identity"
  | "version-set"
  | "resolved-analysis";

export type RawEvidenceAssessment =
  | {
      productStatus: typeof PRODUCT_STATUS;
      evidenceStatus: "PARITY_CANDIDATE";
      scopeVersion: typeof RAW_EVIDENCE_SCOPE_VERSION;
      fixtureId: typeof SMALL_RAW_PARITY_BINDING.fixtureId;
      buildId: string;
      mismatches: [];
    }
  | {
      productStatus: typeof PRODUCT_STATUS;
      evidenceStatus: typeof PRODUCT_STATUS;
      scopeVersion: null;
      fixtureId: null;
      buildId: null;
      mismatches: RawEvidenceMismatch[];
    };

function sameOrderedValues(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function assessRawEvidenceScope(
  result: RawEvidenceResult,
  owner: Pick<RunOwner, "datasetHash" | "specHash">,
  buildId?: string | null,
): RawEvidenceAssessment {
  const mismatches: RawEvidenceMismatch[] = [];

  if (owner.datasetHash !== SMALL_RAW_PARITY_BINDING.datasetSha256) {
    mismatches.push("dataset");
  }
  if (owner.specHash !== SMALL_RAW_PARITY_BINDING.specificationSha256) {
    mismatches.push("specification");
  }
  if (
    typeof buildId !== "string"
    || buildId.trim().length === 0
    || buildId.trim() !== buildId
    || buildId === "local-development"
  ) {
    mismatches.push("build-identity");
  }

  const provenance = result.provenance;
  if (
    result.schemaVersion !== SMALL_RAW_PARITY_BINDING.resultSchemaVersion ||
    provenance.adapter !== SMALL_RAW_PARITY_BINDING.adapter ||
    provenance.adapterVersion !== SMALL_RAW_PARITY_BINDING.adapterVersion ||
    provenance.jenaPackage !== SMALL_RAW_PARITY_BINDING.jenaPackage ||
    provenance.jenaVersion !== SMALL_RAW_PARITY_BINDING.jenaVersion ||
    provenance.jenaCommit !== SMALL_RAW_PARITY_BINDING.jenaCommit ||
    provenance.parityContract !== SMALL_RAW_PARITY_BINDING.parityContract ||
    provenance.legacyGoldenContract !==
      SMALL_RAW_PARITY_BINDING.legacyGoldenContract ||
    provenance.legacyGoldenStatus !==
      SMALL_RAW_PARITY_BINDING.legacyGoldenStatus
  ) {
    mismatches.push("version-set");
  }

  const config = provenance.resolvedConfig;
  if (
    !sameOrderedValues(result.axes, SMALL_RAW_PARITY_BINDING.axes) ||
    config.model !== SMALL_RAW_PARITY_BINDING.resolvedConfig.model ||
    config.window !== SMALL_RAW_PARITY_BINDING.resolvedConfig.window ||
    config.weightBy !== SMALL_RAW_PARITY_BINDING.resolvedConfig.weightBy ||
    config.windowSizeBack !==
      SMALL_RAW_PARITY_BINDING.resolvedConfig.windowSizeBack ||
    config.windowSizeForward !==
      SMALL_RAW_PARITY_BINDING.resolvedConfig.windowSizeForward ||
    config.centerAlignToOrigin !==
      SMALL_RAW_PARITY_BINDING.resolvedConfig.centerAlignToOrigin ||
    result.trajectory?.space !== SMALL_RAW_PARITY_BINDING.trajectorySpace ||
    result.trajectory?.cohortPolicy !== SMALL_RAW_PARITY_BINDING.cohortPolicy
  ) {
    mismatches.push("resolved-analysis");
  }

  if (mismatches.length > 0) {
    return {
      productStatus: PRODUCT_STATUS,
      evidenceStatus: PRODUCT_STATUS,
      scopeVersion: null,
      fixtureId: null,
      buildId: null,
      mismatches,
    };
  }

  return {
    productStatus: PRODUCT_STATUS,
    evidenceStatus: "PARITY_CANDIDATE",
    scopeVersion: RAW_EVIDENCE_SCOPE_VERSION,
    fixtureId: SMALL_RAW_PARITY_BINDING.fixtureId,
    buildId: buildId!,
    mismatches: [],
  };
}
