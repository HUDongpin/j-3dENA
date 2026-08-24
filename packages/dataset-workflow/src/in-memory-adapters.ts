import type { RawScalar, TabularImportFormat, WorksheetDescriptor } from "@3dena/tabular-import";
import { workflowError } from "./errors";
import { ownedBytes, sha256Bytes } from "./hash";
import type {
  AtomicActivationOutcomeV1,
  AtomicActivationRequestV1,
  DatasetWorkflowAuditSink,
  DatasetWorkflowParser,
  DatasetWorkflowStorage,
  GenerationClaimOutcomeV1,
  ImmutableParsedRecordV1,
  ImmutablePutOutcomeV1,
  ImmutableUploadRecordV1,
  ParserInspectRequestV1,
  ParserParseRequestV1,
  StoredActivationRecordV1,
  WorkflowAuditEventV1,
  WorkflowParsedWorksheetV1,
  WorkflowWorkbookInventoryV1,
  UploadIdentityV1,
  ParsedIdentityV1,
} from "./types";

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
}

function cloneRows(
  rows: readonly (readonly RawScalar[])[],
): readonly (readonly RawScalar[])[] {
  return Object.freeze(rows.map((row) => Object.freeze([...row])));
}

function cloneUpload(record: ImmutableUploadRecordV1): ImmutableUploadRecordV1 {
  const bytes = new Uint8Array(record.bytes.byteLength);
  bytes.set(record.bytes);
  return Object.freeze({ ...record, bytes });
}

function cloneParsed(record: ImmutableParsedRecordV1): ImmutableParsedRecordV1 {
  return Object.freeze({
    ...record,
    worksheet: Object.freeze({ ...record.worksheet }),
    headers: Object.freeze([...record.headers]),
    rows: cloneRows(record.rows),
  });
}

function cloneActivation(
  record: StoredActivationRecordV1,
): StoredActivationRecordV1 {
  return structuredClone(record);
}

export class InMemoryDatasetWorkflowStorage implements DatasetWorkflowStorage {
  #generation = 0;
  #uploads = new Map<UploadIdentityV1, ImmutableUploadRecordV1>();
  #parsed = new Map<ParsedIdentityV1, ImmutableParsedRecordV1>();
  #active: StoredActivationRecordV1 | null = null;

  async claimGeneration(generation: number): Promise<GenerationClaimOutcomeV1> {
    if (generation < this.#generation) return "stale";
    if (generation === this.#generation) return "current";
    this.#generation = generation;
    return "claimed";
  }

  async isGenerationCurrent(generation: number): Promise<boolean> {
    return generation === this.#generation;
  }

  async putUpload(record: ImmutableUploadRecordV1): Promise<ImmutablePutOutcomeV1> {
    const existing = this.#uploads.get(record.uploadIdentity);
    if (existing) {
      if (existing.sha256 !== record.sha256
        || existing.byteLength !== record.byteLength
        || existing.format !== record.format
        || !bytesEqual(existing.bytes, record.bytes)) {
        workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload", "immutable upload identity collision");
      }
      return "existing";
    }
    this.#uploads.set(record.uploadIdentity, cloneUpload(record));
    return "created";
  }

  async readUpload(identity: UploadIdentityV1): Promise<ImmutableUploadRecordV1 | null> {
    const record = this.#uploads.get(identity);
    return record ? cloneUpload(record) : null;
  }

  async putParsed(record: ImmutableParsedRecordV1): Promise<ImmutablePutOutcomeV1> {
    const existing = this.#parsed.get(record.parsedIdentity);
    if (existing) {
      if (existing.uploadIdentity !== record.uploadIdentity
        || existing.parserVersion !== record.parserVersion
        || existing.parsedContentSha256 !== record.parsedContentSha256
        || JSON.stringify(existing.worksheet) !== JSON.stringify(record.worksheet)
        || JSON.stringify(existing.headers) !== JSON.stringify(record.headers)
        || JSON.stringify(existing.rows) !== JSON.stringify(record.rows)) {
        workflowError("PARSED_STORAGE_FAILURE", "storage.parsed", "immutable parsed identity collision");
      }
      return "existing";
    }
    this.#parsed.set(record.parsedIdentity, cloneParsed(record));
    return "created";
  }

  async readParsed(identity: ParsedIdentityV1): Promise<ImmutableParsedRecordV1 | null> {
    const record = this.#parsed.get(identity);
    return record ? cloneParsed(record) : null;
  }

  async activateAtomic(
    request: AtomicActivationRequestV1,
  ): Promise<AtomicActivationOutcomeV1> {
    if (request.generation !== this.#generation) return "stale";
    const current = this.#active?.handle.activationIdentity ?? null;
    if (current !== request.expectedActiveActivationIdentity) return "conflict";
    this.#active = cloneActivation(request.next);
    return "activated";
  }

  async readActive(): Promise<StoredActivationRecordV1 | null> {
    return this.#active ? cloneActivation(this.#active) : null;
  }

  /** Aggregate-only deterministic evidence; no bytes, rows, headers, or names. */
  snapshot(): Readonly<{
    currentGeneration: number;
    uploadCount: number;
    parsedCount: number;
    activeActivationIdentity: string | null;
  }> {
    return Object.freeze({
      currentGeneration: this.#generation,
      uploadCount: this.#uploads.size,
      parsedCount: this.#parsed.size,
      activeActivationIdentity: this.#active?.handle.activationIdentity ?? null,
    });
  }
}

export interface InMemoryWorksheetFixtureV1 {
  readonly descriptor: WorksheetDescriptor;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RawScalar[])[];
  readonly skippedBlankRowCount?: number;
}

export interface InMemoryParserFixtureV1 {
  readonly format: TabularImportFormat;
  readonly bytes: ArrayBuffer | ArrayBufferView;
  readonly delimiter: "," | ";" | "\t" | null;
  readonly worksheets: readonly InMemoryWorksheetFixtureV1[];
  readonly vbaDetectedAndDiscarded?: boolean;
}

interface FrozenParserFixture {
  readonly format: TabularImportFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly delimiter: "," | ";" | "\t" | null;
  readonly worksheets: readonly InMemoryWorksheetFixtureV1[];
  readonly vbaDetectedAndDiscarded: boolean;
}

export const IN_MEMORY_PARSER_VERSION = "3dena.in-memory-dataset-parser.v1" as const;

function fixtureWorksheet(
  fixture: InMemoryWorksheetFixtureV1,
): InMemoryWorksheetFixtureV1 {
  if (fixture.descriptor.index < 0
    || fixture.headers.length < 1
    || fixture.rows.length < 1
    || fixture.rows.some((row) => row.length !== fixture.headers.length)) {
    workflowError("PARSER_OUTPUT_INVALID", "fixture.worksheets", "contains an invalid deterministic worksheet");
  }
  return Object.freeze({
    descriptor: Object.freeze({ ...fixture.descriptor }),
    headers: Object.freeze([...fixture.headers]),
    rows: cloneRows(fixture.rows),
    ...(fixture.skippedBlankRowCount === undefined
      ? {}
      : { skippedBlankRowCount: fixture.skippedBlankRowCount }),
  });
}

export class InMemoryDatasetWorkflowParser implements DatasetWorkflowParser {
  readonly parserVersion = IN_MEMORY_PARSER_VERSION;
  readonly #fixtures: readonly FrozenParserFixture[];

  constructor(fixtures: readonly InMemoryParserFixtureV1[]) {
    this.#fixtures = Object.freeze(fixtures.map((fixture) => Object.freeze({
      format: fixture.format,
      bytes: ownedBytes(fixture.bytes, Number.MAX_SAFE_INTEGER),
      delimiter: fixture.delimiter,
      worksheets: Object.freeze(fixture.worksheets.map(fixtureWorksheet)),
      vbaDetectedAndDiscarded: fixture.vbaDetectedAndDiscarded ?? false,
    })));
  }

  #fixture(request: ParserInspectRequestV1): FrozenParserFixture {
    const fixture = this.#fixtures.find((candidate) =>
      candidate.format === request.format && bytesEqual(candidate.bytes, request.bytes));
    if (!fixture) {
      workflowError("PARSER_INSPECTION_FAILURE", "parser.fixture", "no deterministic fixture matches the exact bytes");
    }
    return fixture;
  }

  async inspect(request: ParserInspectRequestV1): Promise<WorkflowWorkbookInventoryV1> {
    const fixture = this.#fixture(request);
    const sha256 = await sha256Bytes(request.bytes);
    if (sha256 !== request.expectedSha256) {
      workflowError("BROWSER_SERVER_SHA256_MISMATCH", "parser.expectedSha256", "does not match exact parser bytes");
    }
    const worksheets = fixture.worksheets.map(({ descriptor }) => Object.freeze({ ...descriptor }));
    return Object.freeze({
      schemaVersion: "3dena.workflow-workbook-inventory.v1",
      format: fixture.format,
      byteLength: request.bytes.byteLength,
      sha256,
      delimiter: fixture.delimiter,
      worksheets: Object.freeze(worksheets),
      visibleSelectableWorksheetCount: worksheets.filter((sheet) => sheet.selectable).length,
      selectionPolicy: "single-visible-auto-otherwise-explicit",
      hiddenWorksheetPolicy: "listed-not-selectable",
      vbaDetectedAndDiscarded: fixture.vbaDetectedAndDiscarded,
      parserVersion: this.parserVersion,
    });
  }

  async parse(request: ParserParseRequestV1): Promise<WorkflowParsedWorksheetV1> {
    const fixture = this.#fixture(request);
    const selectable = fixture.worksheets.filter(({ descriptor }) => descriptor.selectable);
    let selected: InMemoryWorksheetFixtureV1 | undefined;
    if (request.selection === null) {
      if (selectable.length !== 1) {
        workflowError("WORKSHEET_SELECTION_INVALID", "selection", "requires one explicit selectable worksheet");
      }
      selected = selectable[0];
    } else {
      selected = fixture.worksheets[request.selection.index];
      if (!selected
        || selected.descriptor.name !== request.selection.name
        || !selected.descriptor.selectable) {
        workflowError("WORKSHEET_SELECTION_INVALID", "selection", "does not match a selectable worksheet");
      }
    }
    const sha256 = await sha256Bytes(request.bytes);
    if (sha256 !== request.expectedSha256) {
      workflowError("BROWSER_SERVER_SHA256_MISMATCH", "parser.expectedSha256", "does not match exact parser bytes");
    }
    return Object.freeze({
      schemaVersion: "3dena.workflow-parsed-worksheet.v1",
      format: fixture.format,
      byteLength: request.bytes.byteLength,
      sha256,
      delimiter: fixture.delimiter,
      worksheet: Object.freeze({ ...selected!.descriptor }),
      headers: Object.freeze([...selected!.headers]),
      rows: cloneRows(selected!.rows),
      previewRows: cloneRows(selected!.rows.slice(0, 6)),
      rowCount: selected!.rows.length,
      columnCount: selected!.headers.length,
      skippedBlankRowCount: selected!.skippedBlankRowCount ?? 0,
      vbaDetectedAndDiscarded: fixture.vbaDetectedAndDiscarded,
      parserVersion: this.parserVersion,
    });
  }
}

export class InMemoryDatasetWorkflowAuditSink implements DatasetWorkflowAuditSink {
  readonly #events: WorkflowAuditEventV1[] = [];

  record(event: WorkflowAuditEventV1): void {
    this.#events.push(structuredClone(event));
  }

  events(): readonly WorkflowAuditEventV1[] {
    return Object.freeze(this.#events.map((event) => Object.freeze({ ...event })));
  }
}
