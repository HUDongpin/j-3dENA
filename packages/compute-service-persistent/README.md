# `@3dena/compute-service-persistent`

This private workspace package supplies the durable infrastructure that the
memory-only compute candidates explicitly did not provide. It is a production
architecture candidate, not evidence of a deployed Neon/Fly/Vercel service.

## Implemented boundaries

- `migrations/0001_persistent_compute.sql` creates immutable core and HTTP job
  rows, distributed capacity slots, append-only progress events, recovery and
  deletion receipts, transient object custody rows, and an append-only signed
  build-approval registry.
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
  24-hour hard limit.
- `BuildApprovalV1` binds the exact web/compute/package/dependency/migration
  identity. Ed25519 signatures are verified before activation. Readiness is
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

Build the immutable three-file container input from the reviewed explicit
input without signing or activating anything:

```sh
node packages/compute-service-persistent/scripts/build-runtime.mjs \
  packages/compute-service-persistent/deploy/runtime-build-input.example.json \
  output/compute-service
```

The separate migration CLI has explicit `apply` and `verify` modes. Runtime
startup only verifies; it never applies or repairs schema implicitly.

## Current evidence and remaining gates

Package tests exercise Ed25519 tamper rejection, approval/dependency readiness,
private immutable Blob readback and deletion probes, PostgreSQL server-time
claiming with `SKIP LOCKED`, fencing, lost-ack recovery, and worker capacity
release only after observed termination. The HTTP suite proves job operations
fail closed when readiness is false.

Still external and therefore not claimed here: live Neon migrations, two real
Fly Machines, Vercel Private Blob Beta/legal/region approval, container/image
scans, egress controls, production secrets,
Class 1 custody, 2-hour stress, 24-hour soak, canary, rollback, and independent
`BuildApprovalV1` activation. Status remains `IMPLEMENTED_UNVERIFIED`.
