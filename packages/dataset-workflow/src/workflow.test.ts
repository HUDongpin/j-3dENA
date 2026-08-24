import { describe, expect, it } from "vitest";
import {
  DATASET_WORKFLOW_STATUS,
  DEFAULT_DATASET_WORKFLOW_LIMITS,
  DatasetWorkflowError,
  InMemoryDatasetWorkflowAuditSink,
  InMemoryDatasetWorkflowParser,
  InMemoryDatasetWorkflowStorage,
  createBrowserPreflightReceipt,
  createDatasetWorkflow,
  createTabularImportParserAdapter,
  type BrowserPreflightInputV1,
  type DatasetRoleMappingV1,
  type DatasetWorkflowParser,
  type DatasetWorkflowStorage,
  type PrepareDatasetRequestV1,
  type RawScalar,
  type StageUploadRequestV1,
  type WorksheetDescriptor,
} from "./index";

const encoder = new TextEncoder();

function csvBytes(rows: readonly string[]): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${rows.join("\n")}\n`);
}

const HEADERS = [
  "Group",
  "Unit",
  "Conversation",
  "CodeA",
  "CodeB",
  "CodeC",
  "Meta",
] as const;

function validCsv(
  unitA = "0009007199254740993",
  unitB = "0009007199254740994",
): Uint8Array<ArrayBuffer> {
  return csvBytes([
    HEADERS.join(","),
    `A,${unitA},C1,1,0,1,x`,
    `B,${unitB},C2,0,1,1,y`,
  ]);
}

function mapping(
  headers: readonly string[] = HEADERS,
): DatasetRoleMappingV1 {
  const roles = [
    ["unit", "group"],
    ["unit"],
    ["conversation"],
    ["code"],
    ["code"],
    ["code"],
    ["metadata"],
  ] as const;
  return {
    schemaVersion: "3dena.dataset-role-mapping.v1",
    columns: headers.map((header, index) => ({
      index,
      header,
      roles: roles[index] ?? ["unmapped"],
    })),
  };
}

async function stageAndPrepare(
  workflow: ReturnType<typeof createDatasetWorkflow>,
  bytes: Uint8Array<ArrayBuffer>,
  generation: number,
  roleMapping = mapping(),
) {
  const preflight = await createBrowserPreflightReceipt({
    schemaVersion: "3dena.browser-preflight-input.v1",
    declaredExtension: ".csv",
    bytes,
  });
  const inspected = await workflow.stageUpload({
    schemaVersion: "3dena.stage-upload-request.v1",
    generation,
    preflight,
    bytes,
  });
  const parsed = await workflow.parseWorksheet({
    schemaVersion: "3dena.parse-worksheet-request.v1",
    generation,
    uploadIdentity: inspected.uploadIdentity,
    selection: null,
  });
  const prepared = await workflow.prepareDataset({
    schemaVersion: "3dena.prepare-dataset-request.v1",
    generation,
    parsedIdentity: parsed.parsedIdentity,
    mapping: roleMapping,
  });
  return { preflight, inspected, parsed, prepared };
}

describe("dataset workflow limits and strict browser receipt", () => {
  it("freezes the requested primary defaults and rejects unknown fields and R inputs", async () => {
    expect(DEFAULT_DATASET_WORKFLOW_LIMITS).toMatchObject({
      maxFileBytes: 5 * 1024 * 1024,
      maxWorksheets: 32,
      maxRows: 100_000,
      maxColumns: 256,
      maxCells: 5_000_000,
    });
    const source = validCsv();
    await expect(createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
      sourceName: "private-participant-file.csv",
    } as unknown as BrowserPreflightInputV1)).rejects.toMatchObject({
      code: "UNKNOWN_FIELD",
    });
    await expect(createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".rds",
      bytes: source,
    } as unknown as BrowserPreflightInputV1)).rejects.toMatchObject({
      code: "R_WORKSPACE_REJECTED",
    });
    await expect(createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: encoder.encode("RDX3\nserialized"),
    })).rejects.toMatchObject({ code: "R_WORKSPACE_REJECTED" });
  });

  it("takes byte ownership before asynchronous hashing at both custody boundaries", async () => {
    const browserBytes = validCsv();
    const expectedBytes = new Uint8Array(browserBytes);
    const browserReceiptPromise = createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: browserBytes,
    });
    browserBytes.fill(0);
    const [browserReceipt, expectedReceipt] = await Promise.all([
      browserReceiptPromise,
      createBrowserPreflightReceipt({
        schemaVersion: "3dena.browser-preflight-input.v1",
        declaredExtension: ".csv",
        bytes: expectedBytes,
      }),
    ]);
    expect(browserReceipt.sha256).toBe(expectedReceipt.sha256);

    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const serviceBytes = new Uint8Array(expectedBytes);
    const stagePromise = workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight: expectedReceipt,
      bytes: serviceBytes,
    });
    serviceBytes.fill(0);
    const inspected = await stagePromise;
    expect(inspected.uploadIdentity).toBe(`upload:sha256:${expectedReceipt.sha256}`);
  });

  it("prevents a browser receipt from raising the trusted default limit policy", async () => {
    const source = validCsv();
    const elevatedMaxFileBytes = DEFAULT_DATASET_WORKFLOW_LIMITS.maxFileBytes + 1;
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
      limits: { maxFileBytes: elevatedMaxFileBytes },
    });
    const defaultWorkflow = createDatasetWorkflow({
      storage: new InMemoryDatasetWorkflowStorage(),
      parser: createTabularImportParserAdapter(),
    });
    await expect(defaultWorkflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
    })).rejects.toMatchObject({ code: "INVALID_LIMIT" });

    const explicitlyConfigured = createDatasetWorkflow({
      storage: new InMemoryDatasetWorkflowStorage(),
      parser: createTabularImportParserAdapter(),
      limits: { maxFileBytes: elevatedMaxFileBytes },
    });
    await expect(explicitlyConfigured.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
    })).resolves.toMatchObject({ generation: 1 });
  });
});

describe("real tabular-import transaction", () => {
  it("runs exact-byte inventory, mapping, typed preview, atomic activation, and safe downstream read", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const audit = new InMemoryDatasetWorkflowAuditSink();
    const workflow = createDatasetWorkflow({
      storage,
      parser: createTabularImportParserAdapter(),
      audit,
    });
    const source = validCsv();
    const { preflight, inspected, prepared } = await stageAndPrepare(workflow, source, 1);

    expect(preflight).toMatchObject({
      productStatus: DATASET_WORKFLOW_STATUS,
      format: "csv",
      byteLength: source.byteLength,
    });
    expect(preflight.preflightIdentity).toMatch(/^preflight:sha256:[a-f0-9]{64}$/u);
    expect(inspected.uploadIdentity).toBe(`upload:sha256:${preflight.sha256}`);
    expect(inspected.inventory).toMatchObject({
      format: "csv",
      visibleSelectableWorksheetCount: 1,
      selectionPolicy: "single-visible-auto-otherwise-explicit",
    });
    expect(prepared).toMatchObject({
      productStatus: DATASET_WORKFLOW_STATUS,
      activatable: true,
      rowCount: 2,
      columnCount: 7,
    });
    expect(prepared.parsedIdentity).toMatch(/^parsed:sha256:[a-f0-9]{64}$/u);
    expect(prepared.activationIdentity).toMatch(/^activation:sha256:[a-f0-9]{64}$/u);
    expect(prepared.preview.rows[0]?.values.slice(0, 4)).toMatchObject([
      { type: "string", value: "A" },
      { type: "string", value: "0009007199254740993" },
      { type: "string", value: "C1" },
      { type: "double" },
    ]);

    const activation = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    expect(activation).toMatchObject({
      outcome: "activated",
      productStatus: DATASET_WORKFLOW_STATUS,
      active: {
        generation: 1,
        activationIdentity: prepared.activationIdentity,
        receipt: {
          sha256: preflight.sha256,
          format: "csv",
          sheet: null,
          rows: 2,
          columns: 7,
          limits: {
            maxFileBytes: 5 * 1024 * 1024,
            maxWorksheets: 32,
            maxRows: 100_000,
            maxColumns: 256,
            maxCells: 5_000_000,
          },
        },
      },
    });
    const active = await workflow.readActiveDataset();
    expect(active?.rows[0]).toEqual([
      "A",
      "0009007199254740993",
      "C1",
      1,
      0,
      1,
      "x",
    ]);
    expect(storage.snapshot()).toEqual({
      currentGeneration: 1,
      uploadCount: 1,
      parsedCount: 1,
      activeActivationIdentity: prepared.activationIdentity,
    });

    const auditText = JSON.stringify(audit.events());
    expect(auditText).not.toContain("private-participant-file.csv");
    expect(auditText).not.toContain("0009007199254740993");
    expect(auditText).not.toContain("C1");
    expect(audit.events().every((event) => event.productStatus === DATASET_WORKFLOW_STATUS)).toBe(true);
  });

  it("derives stable content identities independently of transaction generation", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const source = validCsv();
    const first = await stageAndPrepare(workflow, source, 1);
    const second = await stageAndPrepare(workflow, source, 2);

    expect(second.preflight.preflightIdentity).toBe(first.preflight.preflightIdentity);
    expect(second.inspected.uploadIdentity).toBe(first.inspected.uploadIdentity);
    expect(second.parsed.parsedIdentity).toBe(first.parsed.parsedIdentity);
    expect(second.prepared.activationIdentity).toBe(first.prepared.activationIdentity);
    expect(storage.snapshot()).toMatchObject({ uploadCount: 1, parsedCount: 1 });
  });

  it("keeps parsed content identity stable but changes activation identity when activated limits change", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const source = validCsv();
    const first = await stageAndPrepare(workflow, source, 1);
    const loweredPreflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
      limits: { maxRows: 1_000 },
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 2,
      preflight: loweredPreflight,
      bytes: source,
    });
    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 2,
      uploadIdentity: inspected.uploadIdentity,
      selection: null,
    });
    const second = await workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 2,
      parsedIdentity: parsed.parsedIdentity,
      mapping: mapping(),
    });

    expect(parsed.parsedContentSha256).toBe(first.parsed.parsedContentSha256);
    expect(parsed.parsedIdentity).toBe(first.parsed.parsedIdentity);
    expect(second.activationIdentity).not.toBe(first.prepared.activationIdentity);
  });

  it("server recomputation rejects changed exact bytes and preserves the prior active dataset", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const first = await stageAndPrepare(workflow, validCsv(), 1);
    const active = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: first.prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    const originalIdentity = active.active!.activationIdentity;

    const secondBytes = validCsv("0009007199254740995", "0009007199254740996");
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: secondBytes,
    });
    const changed = new Uint8Array(secondBytes);
    changed[changed.byteLength - 3] = changed[changed.byteLength - 3] === 121 ? 122 : 121;
    await expect(workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 2,
      preflight,
      bytes: changed,
    })).rejects.toMatchObject({ code: "BROWSER_SERVER_SHA256_MISMATCH" });
    expect((await workflow.snapshot()).active?.activationIdentity).toBe(originalIdentity);
  });
});

describe("worksheet inventory and activation guards", () => {
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const descriptor = (
    index: number,
    name: string,
    selectable = true,
  ): WorksheetDescriptor => ({
    index,
    name,
    visibility: selectable ? "visible" : "hidden",
    kind: "worksheet",
    selectable,
    unselectableReason: selectable ? null : "hidden",
    declaredRowCount: 3,
    declaredColumnCount: 7,
  });

  function workbookParser(rows: readonly (readonly RawScalar[])[] = [
    ["A", "unit-a", "c1", 1, 0, 1, "x"],
    ["B", "unit-b", "c2", 0, 1, 1, "y"],
  ] as const) {
    return new InMemoryDatasetWorkflowParser([{
      format: "xlsx",
      bytes,
      delimiter: null,
      worksheets: [
        { descriptor: descriptor(0, "First"), headers: HEADERS, rows },
        { descriptor: descriptor(1, "Second"), headers: HEADERS, rows },
        { descriptor: descriptor(2, "Hidden", false), headers: HEADERS, rows },
      ],
    }]);
  }

  async function inspectedWorkbook() {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: workbookParser() });
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".xlsx",
      bytes,
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes,
    });
    return { storage, workflow, inspected };
  }

  it("requires exact selection when multiple sheets are selectable and binds the selected sheet to activation", async () => {
    const { workflow, inspected } = await inspectedWorkbook();
    expect(inspected.inventory.worksheets).toHaveLength(3);
    expect(inspected.inventory.visibleSelectableWorksheetCount).toBe(2);
    await expect(workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 1,
      uploadIdentity: inspected.uploadIdentity,
      selection: null,
    })).rejects.toMatchObject({ code: "WORKSHEET_SELECTION_INVALID" });

    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 1,
      uploadIdentity: inspected.uploadIdentity,
      selection: { index: 1, name: "Second" },
    });
    expect(parsed.headers).toEqual(HEADERS);
    const prepared = await workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 1,
      parsedIdentity: parsed.parsedIdentity,
      mapping: mapping(),
    });
    const activated = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    expect(activated.active?.receipt.sheet).toEqual({ index: 1, name: "Second" });
  });

  it("returns typed diagnostics and refuses to replace active state when mapping is scientifically invalid", async () => {
    const { workflow, inspected } = await inspectedWorkbook();
    const invalid: DatasetRoleMappingV1 = {
      schemaVersion: "3dena.dataset-role-mapping.v1",
      columns: HEADERS.map((header, index) => ({
        index,
        header,
        roles: index === 0 ? ["group"] : ["unmapped"],
      })),
    };
    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 1,
      uploadIdentity: inspected.uploadIdentity,
      selection: { index: 0, name: "First" },
    });
    const prepared = await workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 1,
      parsedIdentity: parsed.parsedIdentity,
      mapping: invalid,
    });
    expect(prepared.activatable).toBe(false);
    expect(prepared.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MAPPING_REQUIRES_UNIT",
      "GROUP_MUST_BE_PART_OF_UNIT",
      "MAPPING_REQUIRES_THREE_CODES",
    ]));
    await expect(workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    })).rejects.toMatchObject({ code: "ACTIVATION_BLOCKED" });
    expect((await workflow.snapshot()).active).toBeNull();
  });

  it("diagnoses unsafe numeric identities without echoing the value", async () => {
    const unsafeRows = [
      ["A", 9_007_199_254_740_992, "c1", 1, 0, 1, "x"],
      ["B", 2, "c2", 0, 1, 1, "y"],
    ] as const;
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: workbookParser(unsafeRows) });
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".xlsx",
      bytes,
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes,
    });
    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 1,
      uploadIdentity: inspected.uploadIdentity,
      selection: { index: 0, name: "First" },
    });
    const prepared = await workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 1,
      parsedIdentity: parsed.parsedIdentity,
      mapping: mapping(),
    });
    const diagnostic = prepared.diagnostics.find(({ code }) => code === "UNSAFE_NUMERIC_IDENTITY");
    expect(diagnostic).toMatchObject({ severity: "error", affectedCount: 1 });
    expect(JSON.stringify(diagnostic)).not.toContain("9007199254740992");
  });
});

describe("stale suppression, compare-and-swap, and failure isolation", () => {
  it("rejects parsed-row storage corruption even when metadata and parser version are unchanged", async () => {
    const base = new InMemoryDatasetWorkflowStorage();
    let corruptParsedRows = false;
    const storage: DatasetWorkflowStorage = {
      claimGeneration: (generation) => base.claimGeneration(generation),
      isGenerationCurrent: (generation) => base.isGenerationCurrent(generation),
      putUpload: (record) => base.putUpload(record),
      readUpload: (identity) => base.readUpload(identity),
      putParsed: (record) => base.putParsed(record),
      async readParsed(identity) {
        const record = await base.readParsed(identity);
        if (!record || !corruptParsedRows) return record;
        return {
          ...record,
          rows: record.rows.map((row, rowIndex) => rowIndex === 0
            ? ["private-tampered-participant", ...row.slice(1)]
            : row),
        };
      },
      activateAtomic: (request) => base.activateAtomic(request),
      readActive: () => base.readActive(),
    };
    const audit = new InMemoryDatasetWorkflowAuditSink();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter(), audit });
    const source = validCsv();
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
    });
    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 1,
      uploadIdentity: inspected.uploadIdentity,
      selection: null,
    });
    corruptParsedRows = true;
    let caught: unknown;
    try {
      await workflow.prepareDataset({
        schemaVersion: "3dena.prepare-dataset-request.v1",
        generation: 1,
        parsedIdentity: parsed.parsedIdentity,
        mapping: mapping(),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "PARSED_NOT_FOUND" });
    expect(String(caught)).not.toContain("private-tampered-participant");
    expect(JSON.stringify(audit.events())).not.toContain("private-tampered-participant");
    expect((await workflow.snapshot()).active).toBeNull();
  });

  it("suppresses a late inventory callback after a newer generation claims the fence", async () => {
    const firstBytes = validCsv();
    const secondBytes = validCsv("unit-new-a", "unit-new-b");
    const base = createTabularImportParserAdapter();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const firstHash = (await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: firstBytes,
    })).sha256;
    const delayed: DatasetWorkflowParser = {
      parserVersion: base.parserVersion,
      async inspect(request) {
        if (request.expectedSha256 === firstHash) {
          entered();
          await gate;
        }
        return base.inspect(request);
      },
      parse: (request) => base.parse(request),
    };
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: delayed });
    const firstPreflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: firstBytes,
    });
    const late = workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight: firstPreflight,
      bytes: firstBytes,
    });
    await started;
    const secondPreflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: secondBytes,
    });
    const current = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 2,
      preflight: secondPreflight,
      bytes: secondBytes,
    });
    release();
    await expect(late).rejects.toMatchObject({ code: "STALE_GENERATION" });
    expect(current.generation).toBe(2);
    expect((await workflow.snapshot()).active).toBeNull();
  });

  it("returns stale/conflict outcomes without replacing the active dataset", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const first = await stageAndPrepare(workflow, validCsv(), 1);
    const firstActivation = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: first.prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    const firstIdentity = firstActivation.active!.activationIdentity;

    const second = await stageAndPrepare(workflow, validCsv("new-a", "new-b"), 2);
    const conflict = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 2,
      activationIdentity: second.prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    expect(conflict.outcome).toBe("conflict");
    expect(conflict.active?.activationIdentity).toBe(firstIdentity);

    const thirdBytes = validCsv("third-a", "third-b");
    const thirdPreflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: thirdBytes,
    });
    await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 3,
      preflight: thirdPreflight,
      bytes: thirdBytes,
    });
    const stale = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 2,
      activationIdentity: second.prepared.activationIdentity,
      expectedActiveActivationIdentity: firstIdentity,
    });
    expect(stale.outcome).toBe("stale");
    expect(stale.active?.activationIdentity).toBe(firstIdentity);
  });

  it("sanitizes foreign parser failures and leaves the active dataset unchanged", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const audit = new InMemoryDatasetWorkflowAuditSink();
    const base = createTabularImportParserAdapter();
    const parser: DatasetWorkflowParser = {
      parserVersion: base.parserVersion,
      inspect: (request) => base.inspect(request),
      async parse() {
        throw new Error("secret-person-id=student-123 private-file.xlsx");
      },
    };
    const workflow = createDatasetWorkflow({ storage, parser, audit });
    const source = validCsv();
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
    });
    let caught: unknown;
    try {
      await workflow.parseWorksheet({
        schemaVersion: "3dena.parse-worksheet-request.v1",
        generation: 1,
        uploadIdentity: inspected.uploadIdentity,
        selection: null,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatasetWorkflowError);
    expect(caught).toMatchObject({ code: "PARSER_PARSE_FAILURE" });
    expect(String(caught)).not.toContain("student-123");
    expect(String(caught)).not.toContain("private-file.xlsx");
    expect(JSON.stringify(audit.events())).not.toContain("student-123");
    expect((await workflow.snapshot()).active).toBeNull();
  });

  it("rejects unknown fields returned by storage without exposing them", async () => {
    const base = new InMemoryDatasetWorkflowStorage();
    const storage: DatasetWorkflowStorage = {
      claimGeneration: (generation) => base.claimGeneration(generation),
      isGenerationCurrent: (generation) => base.isGenerationCurrent(generation),
      putUpload: (record) => base.putUpload(record),
      async readUpload(identity) {
        const record = await base.readUpload(identity);
        return record
          ? { ...record, filename: "private-student-upload.csv" } as unknown as typeof record
          : null;
      },
      putParsed: (record) => base.putParsed(record),
      readParsed: (identity) => base.readParsed(identity),
      activateAtomic: (request) => base.activateAtomic(request),
      readActive: () => base.readActive(),
    };
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const source = validCsv();
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
    });
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
    });
    let caught: unknown;
    try {
      await workflow.parseWorksheet({
        schemaVersion: "3dena.parse-worksheet-request.v1",
        generation: 1,
        uploadIdentity: inspected.uploadIdentity,
        selection: null,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "UNKNOWN_FIELD" });
    expect(String(caught)).not.toContain("private-student-upload.csv");
    expect((await workflow.snapshot()).active).toBeNull();
  });

  it("preserves the prior active dataset when atomic activation storage fails", async () => {
    const base = new InMemoryDatasetWorkflowStorage();
    let failActivation = false;
    const storage: DatasetWorkflowStorage = {
      claimGeneration: (generation) => base.claimGeneration(generation),
      isGenerationCurrent: (generation) => base.isGenerationCurrent(generation),
      putUpload: (record) => base.putUpload(record),
      readUpload: (identity) => base.readUpload(identity),
      putParsed: (record) => base.putParsed(record),
      readParsed: (identity) => base.readParsed(identity),
      async activateAtomic(request) {
        if (failActivation) {
          throw new Error("private-id=student-123");
        }
        return base.activateAtomic(request);
      },
      readActive: () => base.readActive(),
    };
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const first = await stageAndPrepare(workflow, validCsv(), 1);
    const firstActivation = await workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 1,
      activationIdentity: first.prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
    });
    const firstIdentity = firstActivation.active!.activationIdentity;
    const second = await stageAndPrepare(workflow, validCsv("next-a", "next-b"), 2);
    failActivation = true;
    let caught: unknown;
    try {
      await workflow.activateDataset({
        schemaVersion: "3dena.activate-dataset-request.v1",
        generation: 2,
        activationIdentity: second.prepared.activationIdentity,
        expectedActiveActivationIdentity: firstIdentity,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "ACTIVATION_STORAGE_FAILURE" });
    expect(String(caught)).not.toContain("student-123");
    expect((await workflow.snapshot()).active?.activationIdentity).toBe(firstIdentity);
  });

  it("rejects unknown fields at every mutating workflow boundary", async () => {
    const storage = new InMemoryDatasetWorkflowStorage();
    const workflow = createDatasetWorkflow({ storage, parser: createTabularImportParserAdapter() });
    const source = validCsv();
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes: source,
    });
    await expect(workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 1,
      preflight,
      bytes: source,
      filename: "not-allowed.csv",
    } as unknown as StageUploadRequestV1)).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });

    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: 2,
      preflight,
      bytes: source,
    });
    await expect(workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 2,
      uploadIdentity: inspected.uploadIdentity,
      selection: null,
      sheetHint: "private-sheet-name",
    } as never)).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
    const parsed = await workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: 2,
      uploadIdentity: inspected.uploadIdentity,
      selection: null,
    });
    const invalidPrepare = {
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 2,
      parsedIdentity: parsed.parsedIdentity,
      mapping: {
        ...mapping(),
        columns: mapping().columns.map((column, index) =>
          index === 0 ? { ...column, rawId: "student-1" } : column),
      },
    } as unknown as PrepareDatasetRequestV1;
    await expect(workflow.prepareDataset(invalidPrepare)).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });

    const prepared = await workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: 2,
      parsedIdentity: parsed.parsedIdentity,
      mapping: mapping(),
    });
    await expect(workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: 2,
      activationIdentity: prepared.activationIdentity,
      expectedActiveActivationIdentity: null,
      participantId: "student-1",
    } as never)).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
    expect((await workflow.snapshot()).active).toBeNull();
  });
});
