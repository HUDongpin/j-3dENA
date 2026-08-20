# `@3dena/compute-service-http`

Status: `IMPLEMENTED_UNVERIFIED`.

This private workspace package is the framework-independent HTTP control plane
for the persistent TypeScript compute architecture. `ComputeV1HttpRouter`
accepts Web-standard `Request` objects and returns `Response` objects, so a
small Node HTTP, Fastify, or equivalent shell can adapt it without moving any
scientific computation into the request handler.

Implemented v1 routes:

- `POST /v1/jobs` creates an origin-bound job capability and immutable upload
  target;
- `POST /v1/jobs/{jobId}/execute` verifies the uploaded exact-byte receipt,
  freezes the analysis request in object storage, and queues a core task;
- `GET /v1/jobs/{jobId}` reports the normalized public lifecycle;
- `GET /v1/jobs/{jobId}/events` streams versioned aggregate progress over SSE;
- `GET /v1/jobs/{jobId}/result` verifies the stored checksum before issuing a
  result reference;
- `DELETE /v1/jobs/{jobId}` idempotently cancels/deletes and returns a data
  deletion receipt;
- `/healthz`, `/readyz`, and `/build-info` expose non-sensitive operational
  identity.

The boundary enforces an explicit CORS allowlist, a negotiated analysis
contract header, job-specific Bearer capabilities, HMAC-hashed capability and
idempotency storage, request/task deadlines, exact JSON envelopes, body limits,
generic non-reflective errors, and checksum verification. Capability plaintext,
idempotency plaintext, raw request bodies, filenames, and scientific values are
not stored in the HTTP repository or returned in errors.

## Deliberately not production-complete

The included repository, event broker, URL issuer, readiness probe, and process
supervisor used by tests are in-memory adapters. They do **not** implement or
prove PostgreSQL durability, S3 encryption/lifecycle policies, signed object
URLs, multi-replica event fan-out, a real isolated Node child process, service
restart recovery, deployment rate limiting, containers, or production
telemetry. A deployment must provide persistent adapters and a periodic
reconciler for terminal cleanup/TTL enforcement; ordinary HTTP reconciliation
alone is not sufficient evidence. No R, rENA, Shiny, or R subprocess is used.
