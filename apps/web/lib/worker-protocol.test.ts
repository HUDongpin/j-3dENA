import { describe, expect, it } from "vitest";
import {
  isAnalysisWorkerRequest,
  isPreparedValidationWorkerRequest,
  type AnalysisWorkerRequest,
  type ValidatePreparedWorkerRequest,
} from "@/lib/worker-protocol";
import { PREPARED_EXCHANGE_MAPPING } from "@/lib/prepared-class1";
import { LEGACY_DEFAULT_MAPPING } from "@/lib/sample-data";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);

describe("worker protocol discriminants", () => {
  it("keeps raw and prepared analysis requests structurally distinct", () => {
    const raw = {
      v: 1,
      kind: "analyze",
      runId: "raw-run",
      input: {
        csvText: "Group,Lesson,Name,EC,ICT,MCO\nG1,L1,S1,1,0,1",
        mapping: LEGACY_DEFAULT_MAPPING,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        debugDelayMs: 0,
      },
    } satisfies AnalysisWorkerRequest;
    const prepared = {
      v: 1,
      kind: "analyze-prepared",
      runId: "prepared-run",
      input: {
        bytes: new ArrayBuffer(1),
        sourceName: "synthetic-prepared.ena3d.json",
        mapping: PREPARED_EXCHANGE_MAPPING,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        debugDelayMs: 0,
      },
    } satisfies AnalysisWorkerRequest;

    expect(isAnalysisWorkerRequest(raw)).toBe(true);
    expect(isAnalysisWorkerRequest(prepared)).toBe(true);
    expect(isAnalysisWorkerRequest({ ...raw, kind: "validate-prepared" })).toBe(
      false,
    );
    expect(
      isAnalysisWorkerRequest({
        ...prepared,
        input: { ...prepared.input, bytes: "not-bytes" },
      }),
    ).toBe(false);
    expect(
      isAnalysisWorkerRequest({
        ...raw,
        input: { ...raw.input, datasetHash: "not-a-hash" },
      }),
    ).toBe(false);
  });

  it("accepts only the dedicated prepared-validation request kind", () => {
    const request = {
      v: 1,
      kind: "validate-prepared",
      requestId: "import-1",
      input: { bytes: new ArrayBuffer(1), sourceName: "sample.ena3d.json" },
    } satisfies ValidatePreparedWorkerRequest;

    expect(isPreparedValidationWorkerRequest(request)).toBe(true);
    expect(
      isPreparedValidationWorkerRequest({ ...request, kind: "analyze-prepared" }),
    ).toBe(false);
    expect(isPreparedValidationWorkerRequest({ ...request, requestId: "" })).toBe(
      false,
    );
    expect(
      isPreparedValidationWorkerRequest({
        ...request,
        input: { ...request.input, bytes: new Uint8Array([1]) },
      }),
    ).toBe(false);
  });
});
