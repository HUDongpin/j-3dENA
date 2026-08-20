# `@3dena/compute-service-core`

Status: `IMPLEMENTED_UNVERIFIED`.

Framework-independent orchestration contracts for a future persistent 3DENA
compute service. This package owns job state, leases, compare-and-set result
publication, process-capacity accounting, TTL/deadline behavior, deletion
receipts, and allowlisted operational events. It does not run jENA itself.

## Current implementation boundary

The package contains interfaces for:

- a compare-and-set `ComputeTaskRepository`;
- an immutable `ComputeObjectStore`;
- a `ComputeProcessSupervisor` whose termination promise is the authoritative
  observation that a child has stopped;
- an allowlisted `ComputeAuditSink`;
- injectable clocks and identifier factories.

It also contains deterministic in-memory implementations for tests. There is
**no PostgreSQL repository, S3 adapter, queue, container runtime, deployment,
or distributed capacity coordinator in this package**. A production adapter
must prove its own transaction, consistency, custody, retry, authentication,
encryption, and recovery behavior.

## Scientific ownership and immutable requests

Every request is owned by:

```text
datasetHash + specHash + runId + taskId + contractVersion
```

The request embeds only a content-addressed input-object receipt. It does not
embed raw rows. Creation is idempotent only when the complete canonical request
fingerprint matches; reusing a `taskId` with different immutable metadata is a
hard conflict. All public records and receipts returned by the core are cloned
and deeply frozen.

Concurrent conflicting creates retain only the authoritative row's canonical
request object. Cleanup uses the immutable put receipt's `created` bit and, for
a shared pre-existing candidate, re-reads the authoritative task row before
deletion. Absence is verified after cleanup. This closes the in-process race,
but a persistent object store/repository pair still needs a durable orphan
reconciler for process death or network failure between object put and row CAS.

## Lease and process rules

- A claim creates a monotonically increasing lease epoch.
- Heartbeats are accepted only for the active, unexpired lease.
- Execution is idempotent for the same active lease and attempt.
- Each attempt receives a lease-specific result-object key.
- Result metadata is published with repository compare-and-set only while that
  exact lease still owns a running process.
- Lease expiry invalidates publication immediately. A running stale child is
  terminated and the job is requeued only after termination is observed.
- Cancel, timeout, TTL expiry, and deletion request termination but do not free
  capacity. The slot is released only by the supervised child's resolved
  termination observation.
- Normal process exit finalizes success only when a CAS-published result exists.
- Process launch has a versioned deadline and `AbortSignal`. If `spawn()` has
  not settled at the deadline, the attempt becomes observably cancelling with
  `PROCESS_LAUNCH_TIMED_OUT`, but its slot remains occupied. A later child is
  terminated and the slot is released only after its termination promise
  resolves. A later supervisor rejection may release the unbound slot because
  the supervisor contract defines rejection as proof that no child launched.
- A `spawn()` promise that ignores abort and never settles deliberately leaves
  the slot occupied. This fail-closed behavior avoids inventing termination;
  production still requires supervisor watchdog/alerting and restart recovery.
- Callers must run `sweep()` on a durable schedule; this core does not provide a
  scheduler. A supervisor termination promise must resolve exactly once and
  must not reject. Adapter failure remains fail-closed and never releases a slot
  without a termination observation.

## Logs and deletion

Audit events use a closed schema containing a one-way `taskRef`, state, reason
code, lease epoch, and capacity counts. They intentionally contain no
`datasetHash`, `specHash`, `runId`, `taskId`, object key, request/result body,
error message, participant identifier, or research context.

Audit/object-store side-effect failures do not undo repository state or prevent
an already-required process termination. They are counted and surfaced by
`settleBackground()`. Diagnostics use a fixed 64-record ring containing only a
version, allowlisted component, allowlisted code, and timestamp. Caught Error
objects, messages, stacks, causes, owner values, and object keys are never
retained. A persistent adapter still needs a transactional outbox and retry
worker; the in-memory sink is not a durable audit implementation.

Deletion removes the stored canonical request object and every result-object
key owned by execution attempts, then verifies absence. Input objects cannot
use service-owned request/result namespaces and are never requested for deletion
by this core; the receipt records whether the input receipt was still observed
at completion instead of claiming that an external store retained it. The
repository tombstone retains contract metadata; production retention and
erasure policy remain an adapter/release decision.
