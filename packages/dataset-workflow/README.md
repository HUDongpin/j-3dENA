# `@3dena/dataset-workflow`

Status: **`IMPLEMENTED_UNVERIFIED`**.

This private TypeScript package is the transactional state/adapter core for
turning an uploaded CSV, XLSX, or XLS byte sequence into one active, typed
dataset. It contains no UI, HTTP route, database driver, object-store driver,
or analysis runtime. Its unit tests are implementation evidence only; they do
not establish browser support, scientific parity, deployment readiness, or
production readiness.

## Transaction

The public flow is deliberately split so that a client never has to guess
worksheet headers before parsing:

1. `createBrowserPreflightReceipt()` takes ownership of browser bytes before
   its first asynchronous operation, enforces limits, rejects declared R input,
   and computes a SHA-256-bound preflight receipt. The input accepts an
   extension, not a raw filename.
2. `workflow.stageUpload()` is intended to run at a trusted service boundary.
   It independently takes ownership of the received bytes and recomputes their
   exact length and SHA-256 before immutable upload custody. It then returns a
   worksheet inventory.
3. `workflow.parseWorksheet()` requires an exact `{ index, name }` selection
   when more than one visible worksheet is selectable. It stores the parsed
   record immutably and returns only the selected worksheet metadata, ordered
   headers, dimensions, and `parsedIdentity`—not source rows.
4. `workflow.prepareDataset()` binds an ordered role mapping to that parsed
   identity. It returns the typed six-row preview, exact schema, aggregate
   diagnostics, `activationIdentity`, and an `activatable` flag.
5. `workflow.activateDataset()` validates the prepared candidate and uses the
   storage adapter's generation-fenced compare-and-swap operation. A rejected,
   stale, conflicting, or failed attempt never asks the adapter to replace the
   existing active record.

```ts
import {
  InMemoryDatasetWorkflowStorage,
  createBrowserPreflightReceipt,
  createDatasetWorkflow,
  createTabularImportParserAdapter,
} from "@3dena/dataset-workflow";

const preflight = await createBrowserPreflightReceipt({
  schemaVersion: "3dena.browser-preflight-input.v1",
  declaredExtension: ".csv",
  bytes: browserBytes,
});

const workflow = createDatasetWorkflow({
  storage: new InMemoryDatasetWorkflowStorage(),
  parser: createTabularImportParserAdapter(),
});

const inspected = await workflow.stageUpload({
  schemaVersion: "3dena.stage-upload-request.v1",
  generation: 1,
  preflight,
  bytes: serviceReceivedBytes,
});

const parsed = await workflow.parseWorksheet({
  schemaVersion: "3dena.parse-worksheet-request.v1",
  generation: 1,
  uploadIdentity: inspected.uploadIdentity,
  selection: null, // valid only when exactly one worksheet is selectable
});

const prepared = await workflow.prepareDataset({
  schemaVersion: "3dena.prepare-dataset-request.v1",
  generation: 1,
  parsedIdentity: parsed.parsedIdentity,
  mapping: {
    schemaVersion: "3dena.dataset-role-mapping.v1",
    columns: parsed.headers.map((header, index) => ({
      index,
      header,
      roles: roleForHeader(header),
    })),
  },
});

if (prepared.activatable) {
  await workflow.activateDataset({
    schemaVersion: "3dena.activate-dataset-request.v1",
    generation: 1,
    activationIdentity: prepared.activationIdentity,
    expectedActiveActivationIdentity: null,
  });
}
```

## Identities and state ownership

- `preflightIdentity` binds the format, byte length, exact-byte SHA-256, and
  complete activated limit set.
- `uploadIdentity` is `upload:sha256:<exact-byte-sha256>`.
- `parsedIdentity` binds the upload identity, versioned parser adapter, exact
  format/delimiter, worksheet selection, ordered headers, parsed dimensions,
  skipped-blank-row count, VBA-discard receipt, and a `parsedContentSha256`
  over the exact ordered typed headers and rows. A stored-row change is
  rejected even if every dimension and parser metadata field is unchanged;
  changing parser behavior still requires a new parser version.
- `activationIdentity` binds the parsed identity and exact typed schema/role
  mapping, effective primary limits, and aggregate warning codes.
- A positive `generation` is a freshness fence, not a content identity. Late
  inventory, parse, prepare, and activation work is suppressed by currentness
  checks plus the storage adapter's atomic generation check.

Prepared candidates are intentionally process-local in this implementation.
The immutable upload and parsed records plus active handle live behind
`DatasetWorkflowStorage`; a future durable orchestration layer must define how
pending candidates survive process restarts.

## Default limits

The defaults are inherited from the reviewed public API of
`@3dena/tabular-import` and are embedded in every preflight identity:

| Limit | Default |
|---|---:|
| Exact input bytes | 5 MiB |
| Worksheets | 32 |
| Data rows | 100,000 |
| Columns | 256 |
| Cells | 5,000,000 |
| Cell string length | 32,768 |
| ZIP entries | 512 |
| ZIP total uncompressed bytes | 64 MiB |
| ZIP entry uncompressed bytes | 32 MiB |
| ZIP compression ratio | 250 |
| ZIP path depth | 16 |

Requested limits are strict objects, must remain under the underlying hard
ceilings, and become part of the preflight identity. The workflow also has a
trusted `dependencies.limits` ceiling (the defaults above when omitted), so an
untrusted browser receipt can lower but cannot raise service policy. Parser
inventories and parsed results are independently checked against the activated
limits.

## Security and failure semantics

- Only `.csv`, `.xlsx`, and `.xls` are accepted. `.RData`, `.rda`, and `.rds`
  declarations are rejected; uncompressed `RDX2`, `RDX3`, `RDA2`, and `RDA3`
  workspace signatures are also rejected before parsing. The real tabular
  parser remains the final magic-byte and archive-policy boundary.
- Request, receipt, parser-output, and storage-output DTOs reject unknown
  fields. Errors use closed codes and contract-only paths/messages.
- The real parser adapter calls only the public `inspectTabularSource()` and
  `parseTabularWorksheet()` APIs. It supplies a synthetic format-only basename,
  so a source filename does not enter the workflow.
- Audit events are a closed aggregate-only schema. They contain event kind,
  generation, content identity, outcome, and error code; they have no filename,
  header, raw-row, cell-value, or participant-ID field. Foreign adapter error
  messages are not propagated. The optional audit sink cannot block or mutate
  activation.
- `activateAtomic()` is the commit point. A conforming durable adapter must
  atomically check both the current generation and expected active activation
  identity before replacing the active record. The deterministic in-memory
  adapter demonstrates this contract but is not durable storage.

Raw parsed rows necessarily exist inside the parser/storage custody boundary
and are returned only by the explicit `readActiveDataset()` data-plane method.
They are not included in snapshots, candidates before mapped preview, audit
events, or thrown workflow messages.

## Adapters and deterministic tests

- `createTabularImportParserAdapter()` wraps the production-facing tabular
  import package without importing its internals.
- `DatasetWorkflowStorage` and `DatasetWorkflowParser` are injectable ports.
- `InMemoryDatasetWorkflowStorage` provides deterministic immutable puts,
  generation fencing, and active-record compare-and-swap.
- `InMemoryDatasetWorkflowParser` accepts exact-byte workbook fixtures for
  deterministic state-machine tests.
- `InMemoryDatasetWorkflowAuditSink` captures only the safe audit DTO.

Package-local checks:

```sh
npm run lint --prefix packages/dataset-workflow
npm run typecheck --prefix packages/dataset-workflow
npm test --prefix packages/dataset-workflow
npm run build --prefix packages/dataset-workflow
```

## Explicitly not implemented or verified

- browser UI, browser-worker wiring, HTTP upload handling, authentication, and
  CSRF/session policy;
- durable blob/database adapters, distributed locks, multi-process recovery,
  retention/deletion policy, and storage encryption;
- restart-safe persistence of inspected/prepared candidates;
- end-to-end browser, real service, maximum-workload, soak, crash-recovery, and
  cross-browser evidence;
- an exhaustive compressed/mislabeled R serialization detector beyond the
  declared-extension, uncompressed workspace-signature, and tabular-parser
  boundaries above;
- analysis execution, spreadsheet export workflow, oracle comparison,
  numerical parity, release evidence, deployment, or publication;
- integration into the Web product and persistent compute service as the
  authoritative upload, inventory, mapping, preview, activation, analysis, and
  export workflow.

Accordingly, every public state-bearing result reports
`IMPLEMENTED_UNVERIFIED`; no narrower unit test should be interpreted as
`VERIFIED_PARITY`, `PRODUCTION_CANDIDATE`, or completion of the 3DENA product.
