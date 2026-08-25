# `@3dena/compute-service-persistent`

This private workspace package supplies the durable infrastructure that the
memory-only compute candidates explicitly did not provide. It is a production
architecture candidate, not evidence of a deployed Neon/Fly/Vercel service.

## Implemented boundaries

- `migrations/0001_persistent_compute.sql` creates immutable core and HTTP job
  rows, distributed capacity slots, append-only progress events, recovery and
  deletion receipts, transient object custody rows, and an append-only signed
  build-approval registry.
- `migrations/0002_persistent_control_plane.sql` is the append-only control-plane
  expansion for exact attempt fencing, quarantine/termination receipts,
  singleton server-time scheduling, and generation-fenced Blob lifecycle rows.
- `migrations/0003_build_approval_v3.sql` append-only widens the approval JSON
  constraint to the signed V3 scientific-build identity while retaining read
  compatibility for historical V1/V2 approval rows.
- `migrations/0004_scientific_result_generations.sql` preserves every immutable
  `compute_scientific_results` row as generation 1, adds append-only publication
  generations, and separates them from a deletable active mapping. An unexpired
  mapping remains fail-closed; after expiry the same scientific result hash can
  bind a new task/object generation without rewriting legacy or new evidence.
- `PostgresComputeTaskRepository` and
  `PostgresComputeHttpJobRepository` preserve create idempotency and revision
  compare-and-set semantics. `PostgresComputeHttpEventBroker` uses a durable
  cursor table and polling; it does not use `LISTEN` or session advisory locks,
  so it is compatible with transaction pooling.
- `PostgresDistributedLeaseCoordinator` uses PostgreSQL server time,
  transactions, row locks, `FOR UPDATE SKIP LOCKED`, global capacity slots,
  monotonically increasing lease and fencing epochs, heartbeat, release, and
  expired-claim recovery. A result published before a lost acknowledgement is
  finalized through an append-only `ack_replayed` receipt; otherwise an
  expired attempt is fenced and requeued or reaches its approved terminal
  deadline/TTL outcome.
- `VercelPrivateBlobObjectStore` accepts an injected official-client adapter,
  enforces private access, no overwrite, no random suffix, zero cache age,
  full-byte readback and SHA-256 verification, opaque content-derived
  pathnames, and both HEAD and GET absence probes before deletion attestation.
  Its default ledger deadline is 23 hours so deletion retries start before the
  24-hour hard limit. Provider writes and deletes are fenced by durable
  `intent -> available -> deleting -> deleted` transitions; orphan deletion
  also records a retryable intent before provider mutation.
- `BuildApprovalV1` binds the exact web/compute/package/dependency/migration
  identity, including jENA version/commit/tarball SRI and the trajectory SDK
  version/build ID. Ed25519 signatures are verified before activation. Readiness is
  false for missing, mismatched, revoked, invalid, or dependency-failed builds.
  The HTTP control plane now also checks readiness before every capability-
  scoped `/v1/jobs` operation, so it cannot execute while `/readyz` is red.
- `PersistentComputeWorker` polls one claim at a time, heartbeats its durable
  lease, waits for an observed terminal state before releasing capacity, and
  leaves a non-terminal slot for fenced recovery rather than inferring cleanup.

## Composition and dependencies

`src/runtime-entry.ts` and `src/runtime-support.ts` are the versioned API/worker
composition. They bind `pg@8.22.0` and `@vercel/blob@2.8.0`, use the pooled Neon
URL only for the API role and the direct URL for the worker role, keep Blob and
database secrets in the parent, and pass only locale/runtime controls to the
scientific child. Startup verifies the exact migration, active signed build
approval, configured capacity rows, Blob credential reachability, and bundle
hashes before readiness or work.
The 60-second retention loop deletes expired source-result active mappings in
bounded pages while leaving both the legacy `compute_scientific_results` table
and the generational publication table immutable. Resolvers join only the
unexpired active mapping to its exact publication generation and still verify
the object HEAD, byte length, SHA-256, artifact envelope, owner, build, and
scientific result hash before returning a source.
The Node HTTP bridge keeps each Web `Request.signal` bound to the real socket
for the complete response lifetime. A browser or proxy disconnect therefore
aborts the router subscription and cancels the SSE response reader instead of
leaving a PostgreSQL polling iterator behind; a normally completed response is
not treated as an abort.

Dedicated `POST /v2/longitudinal-jobs` creation additionally requires the
`x-3dena-service-token` header. The compute runtime stores only its SHA-256 in
the protected `LONGITUDINAL_SERVICE_TOKEN_SHA256` environment variable; a
trusted Open ENA server-side caller owns the plaintext token. Browser `Origin`
is not authentication, and unverified authorization text is excluded from the
rate-limit key.

Build the immutable three-file container input from the reviewed explicit
input without signing or activating anything:

```sh
node packages/compute-service-persistent/scripts/build-runtime.mjs \
  packages/compute-service-persistent/deploy/runtime-build-input.example.json \
  output/compute-service-candidate-20260825T010000Z
```

The destination must be a new `output/compute-service-candidate-*` directory.
Docker has no fallback bundle: the image build must explicitly pass that exact
directory and the reviewed SDK version as `RUNTIME_BUNDLE_DIR` and
`EXPECTED_SDK_VERSION`, plus the public artifact `EXPECTED_BUILD_ID`. The image
build rechecks the v4 manifest source commit against the OCI revision, all six
contracts, all four migrations, dependency pins, scientific identity, and
both artifact digests before it can receive the current Git revision label.

The separate migration CLI has explicit `apply` and `verify` modes. Runtime
startup only verifies; it never applies or repairs schema implicitly.

## Current evidence and remaining gates

Package tests exercise Ed25519 tamper rejection, approval/dependency readiness,
private immutable Blob readback and deletion probes, PostgreSQL server-time
claiming with `SKIP LOCKED`, fencing, lost-ack recovery, and worker capacity
release only after observed termination. The HTTP suite proves job operations
fail closed when readiness is false.

The `0001-persistent-compute` expand migration has now been executed on the
Owner's Singapore Neon `main` branch as a technical candidate. The source hash,
target identifiers, exact registry result, append-only probe, transaction
rollback, child-branch reset/deletion probe and evidence limitations are recorded in
`evidence/cloud/2026-08-21-neon-migration-execution.json`. This implementation-
operator receipt is not independent approval or a signed `BuildApprovalV1`.

Vercel Preview database branching is enabled and one exact Git-sourced Preview
deployment automatically created a Vercel-owned Neon child branch. A read-only
query confirmed the expected migration version/hash and 17 tables on that
branch. This proves the integration mechanism, not independent Preview approval.

Still external and therefore not claimed here: independently approved,
BuildApproval-bound Preview isolation, two real Fly Machines, Vercel Private Blob
Beta/legal/region approval,
container/image scans, egress controls, production secrets, Class 1 custody,
restart/capacity/TTL/deletion probes, 2-hour stress, 24-hour soak, canary, full
rollback, and independent `BuildApprovalV1` activation. Status remains
`IMPLEMENTED_UNVERIFIED`.
