# `@3dena/compute-service-node`

Status: **`IMPLEMENTED_UNVERIFIED`**.

This private package contains two connected candidates:

1. a real Node.js `child_process` implementation of the
   `ComputeProcessSupervisor` boundary in `@3dena/compute-service-core`; and
2. a fixed scientific child entry plus a parent-side session adapter that can
   execute the public `@3dena/analysis` `executeAnalysisTask` contract.

It is executable engineering evidence, but it is not a production compute
service, a production container, or scientific parity evidence.

## Process-supervisor candidate

- The worker entry and Node executable must be absolute regular files. Their
  canonical paths are frozen when the supervisor is constructed.
- The adapter invokes the fixed Node executable with the fixed worker entry,
  an empty argument surface, and `shell: false`.
- The child receives no inherited process environment. Only `LANG`, `LC_ALL`,
  `TZ`, and `NODE_ENV` may be supplied through the versioned options contract;
  runtime-injection variables such as `NODE_OPTIONS`, `NODE_PATH`, `PATH`,
  `LD_PRELOAD`, and `DYLD_*` are not accepted.
- `stdin`, `stdout`, and `stderr` are all `ignore`; they are neither inherited,
  captured, retained, nor logged. The adapter has no logging callback. A
  fixture writes private-marker text to both output streams and tests confirm
  that it does not enter adapter errors.
- Launch succeeds only after an exact `3dena.compute-node-ipc.v1` `ready`
  message whose `executionId` matches the launch envelope. Unknown readiness
  fields fail closed.
- The core launch `AbortSignal` and deadline remain active until readiness. An
  abort or deadline sends `SIGTERM`, escalates to `SIGKILL` after a bounded
  grace, waits for the real child `close`, and only then rejects launch.
- `requestTermination` is idempotent. Duplicate and post-close requests are
  no-ops and do not extend the grace period.
- A returned child's `termination` promise resolves exactly once and only from
  the actual Node `close` observation. A requested stop maps to `terminated`;
  an unrequested validated exit code 0 maps to `completed`; all other observed
  outcomes map to `crashed`.
- Launch/deadline timers, abort and child listeners, session state, and the live
  registry are removed after readiness or close as applicable. Public
  snapshots contain counts only, never child IDs, owners, object keys, caught
  errors, or scientific values.

## Scientific-child candidate

- The worker bundle has a fixed entry and uses Node advanced IPC serialization.
  Its launch payload is a versioned, structured-clone-safe
  `AnalysisExecutionDataset` union and `AnalysisTaskV1`; it does not hard-code
  the legacy V1 `sourceResult` shape.
- `JsonObjectStoreScientificInputProvider` reads a strict versioned JSON input
  wrapper. It compares the immutable object head, byte count, and a freshly
  computed SHA-256 over the bytes actually returned by the store. Dataset hash,
  spec hash, run/task identity, task kind, and deadline must match the core
  launch owner.
- The child calls only the public `@3dena/analysis executeAnalysisTask` entry.
  It creates a canonical JSON result artifact and SHA-256 descriptor. The
  parent session independently checks the bytes, checksum, size, artifact
  owner, task kind, and envelope owner before an injected immutable object
  store accepts the artifact.
- After the artifact store acknowledgement, the child sends an exact
  publication request bound to `executionId`, compute owner, current lease, and
  immutable object descriptor. It exits with code 0 only after the injected
  publisher returns a matching, versioned publication receipt and the parent
  sends that receipt back as an acknowledgement.
- A publisher can use `ComputeServiceCore.publishResult` for the actual
  lease-fenced compare-and-set, as the integration tests do. A mismatched or
  failed publication never receives a success acknowledgement.
- Invalid input, scientific execution failure, deadline, artifact failure,
  publication failure, and protocol failure use a six-value allowlist. Caught
  messages, stacks, causes, rows, participant IDs, and object contents are not
  copied into IPC failure messages or snapshots.
- Cancellation and deadline still use observed process termination. The child
  cannot claim completion while a publication is withheld, and core keeps its
  capacity slot until close is observed.
- `FileSystemImmutableResultStore` is a test/local adapter. It canonicalizes an
  existing absolute root, hashes logical object keys into filenames, creates
  files with exclusive `wx` semantics and mode `0600`, syncs file contents,
  compares replayed bytes, and removes a partial newly created file on a failed
  write.

## Executable package evidence

The Vitest suite launches real Node child processes. It covers:

1. exact ready handshake followed by exit 0 and a non-zero crash;
2. duplicate termination and post-close idempotency;
3. abort before ready and rejection of a readiness message with unknown data;
4. bounded `SIGTERM` to `SIGKILL` escalation;
5. core capacity remaining occupied until actual child close;
6. immutable scientific input byte re-hashing;
7. a real small-raw `ena-model` execution through `@3dena/analysis`;
8. artifact checksum/owner/lease binding and the publish-acknowledgement gate;
9. cancellation and deadline while publication is withheld, including
   unpublished artifact cleanup through core;
10. a publisher exception containing a private marker, mapped to a fixed
    process outcome without message retention; and
11. malformed V2 execution data failing after ready without publication or
    private-field disclosure.

Package-local checks are:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run diff-check
```

## Explicitly missing production evidence

This package provides no PostgreSQL repository, S3-compatible object storage,
durable job queue, distributed lease claimant, global capacity control,
restart reconciliation, process reattachment, or acknowledgement replay. The
supervisor registry and in-flight session bindings are process-local. If this
adapter is used outside `ComputeServiceCore`, a stored but unpublished result
can remain orphaned; this package does not pretend to own a durable recovery
scanner.

The filesystem adapter is not an S3 substitute. It has no multi-host atomicity,
directory `fsync` receipt, server-side encryption contract, object lifecycle or
TTL policy, deletion attestation, backup exclusion, or fault-injection/soak
evidence. Scientific input and result bytes are currently copied through IPC,
so the candidate also lacks a calibrated large-workload memory/copy budget.

The bundled worker proves only the current package tests and one small raw ENA
slice. It does not establish the full scientific oracle matrix, Class 1 raw
parity, all ENA configurations, Comparison, Change, Stats,
trajectory/comparison/bootstrap, browser consumption, export parity, or public
npm packaging. The source aliases used by the package-local bundle build are
not a reviewed successor dependency graph or publication receipt.

jENA's synchronous model/SVD work is not cooperatively cancellable here.
Cancellation can stop the process, but only after the operating system observes
termination; no claim is made about partial in-process progress. No R/rENA or
Shiny runtime is introduced by this package.

Finally, there is no production-container or deployment receipt: no non-root
image, read-only root filesystem, cgroup CPU/memory/PID limit, default-deny
egress, private-network policy, image scan, SBOM, capacity benchmark, soak,
PostgreSQL/S3 recovery exercise, or production monitoring evidence. These are
release blockers, so the package remains **`IMPLEMENTED_UNVERIFIED`**.
