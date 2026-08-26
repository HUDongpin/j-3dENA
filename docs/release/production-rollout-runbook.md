# Production rollout and rollback runbook

Status: executable operating contract; no deployment has been performed. Replace
only the bracketed deployment identities with independently reviewed values. Do
not paste credentials into this file, shell history, logs, or release artifacts.

## 1. Preconditions

Stop before any external mutation unless all of the following are true:

1. The authorized Git remote matches package provenance and the release commit
   exists in a clean checkout rebuilt with the frozen npm version and `npm ci`.
2. `npm run check`, the protected scientific/strict-ledger gates, the reviewed
   exact single-instance `jena-js@0.7.0-ona.0` custody gate, and all release
   security jobs pass for that commit.
   The local public-package gate inside `npm run check` must report the current
   Git phase: source commits build and smoke a temporary artifact, while
   generated commits verify the tracked custody bytes without rebuilding them.
3. The public analysis tarball, complete lock-graph SBOM, schema bundle, exact
   migration, Vercel build, and Fly OCI digest are hashed into one candidate
   `3dena.build-approval.v4`; an independent release reviewer has signed it.
   Preserve the strict `keys -> image -> candidate` order: independently
   materialize/verify the public-key reviewer-policy registry without an image identity, include its
   exact bytes in the image, obtain the real immutable digest, and only then
   materialize/verify the schema bundle and hash-pinned unsigned candidate
   input. The Docker build now requires the verified registry directory and
   expected registry SHA-256, copies only that exact public registry into the
   image, and verifies it before making `/app` read-only. This source contract
   is not an image receipt: release remains fail-closed until a real independent
   registry is supplied and the resulting immutable image is built and scanned.
   None of these tooling receipts is a signature or activation.
   Dispatch the exact-image scan with the registry SHA-256 taken from the
   independently verified key-materialization manifest. The scan must extract
   the registry from the same immutable image digest and issue a
   `3dena.container-scan-receipt.v2`; the `3dena.release-receipts.v2` gate then
   securely reads the raw signed approval, registry, materialization manifest,
   scan receipt, Docker inspect, registry-verification receipt, and SARIF bytes.
   It cross-binds the signed Fly digest, source commit, and registry hash instead
   of trusting duplicated hand-entered fields.
   After every required receipt has completed, an independent reviewer must sign
   the canonical final matrix with `3dena.release-receipts-approval.v1`. The
   approval timestamp must be later than every receipt, the reviewer must remain
   outside the signed implementation-actor set, and any later receipt, descriptor,
   identity, timestamp, or approval-metadata change invalidates the signature.
4. The signed approval is active in the append-only Neon approval registry for
   the target environment, and both Web and compute readiness reject every other
   manifest hash. Configure the exact signed candidate's
   `BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256` for both Fly process groups;
   it is runtime identity, not a secret and not an image build argument.
   Run BuildApproval activation/verification and capacity apply/verification
   only from the reviewed custody root, using portable root-relative paths and
   all mandatory external pins documented in
   `packages/compute-service-persistent/deploy/README.md`. The BuildApproval CLI
   requires independently handed-off config, signed-approval, and registry
   SHA-256 values. The capacity CLI requires independently handed-off config,
   active approval-manifest, and registry SHA-256 values. The migration CLI
   likewise requires the externally pinned migration-config SHA-256. Do not derive these
   pins by hashing the same files inside the operator invocation or copy them
   from the config under review; that would turn evidence into its own trust
   root. Preserve the exact command, custody-root identity, input pins, result,
   and non-secret file digests in the release evidence.
5. Preview is isolated by Vercel deployment, Neon branch/schema, Fly staging app,
   and private staging object namespace. Preview and production have no Class 1
   custody permission.
6. The legal, data-region, private-storage/deletion, budget/capacity, and source-
   availability decisions are approved and attached to the build manifest.

## 2. Expand and preview

1. Apply only the reviewed expand phase of the exact Neon migration. Do not drop,
   rename, narrow, or reinterpret data still required by the currently approved
   production build.
2. Deploy the exact Fly API and worker image to staging by OCI digest. Start at
   least two Machines so distributed lease, fencing, capacity, restart, and
   acknowledgement replay are exercised rather than inferred from one process.
3. Deploy the exact Vercel preview build with its preview approval and staging
   compute identity. It must fail closed if any production endpoint or approval
   is supplied.
4. Run spreadsheet upload through download for CSV, XLS, XLSX, and prepared
   exchange; all seven task/result variants; cancel/delete; stale activation;
   API/worker restart; Blob and Neon outage; TTL/deletion probe; browser matrix;
   accessibility; security; capacity; two-hour stress; and 24-hour soak.
5. Produce immutable receipt artifacts. Do not replace a failed receipt with a
   screenshot, log excerpt, rerun against another build, or reviewer self-approval.

## 3. Stage production without traffic

1. Create a staged Vercel production deployment from the approved commit without
   immediately assigning full traffic.
2. Deploy one Fly API canary and one Fly worker canary using the approved OCI
   digest. Existing Machines remain on the last approved compatible digest.
3. Verify `/readyz` and `/build-info` expose the active approval manifest, release,
   Git commit, Fly digest/build and compatible contracts. Verify Neon and object
   store connectivity, one scientific smoke, hard cancel, authenticated deletion,
   and capacity release.
4. Confirm new and old builds can coexist under the expand schema and that each
   refuses incompatible jobs/results instead of guessing or locally falling back.

## 4. Canary progression

Advance only in this order: `5% → 25% → 100%`. Each stage must observe at least
one complete representative workload window and issue its own receipt against the
same build approval. At every stage review:

- HTTP/readiness/error rate and exact build identity;
- queue depth, lease age, capacity use and stale-publication rejection;
- task duration/CPU/RSS buckets and worker exits;
- cancel/timeout/crash/restart and late-result fencing;
- object creation, 23-hour sweeper retries, deletion lag and not-found probes;
- aggregate-only log/metric inspection for prohibited raw/user context;
- browser upload, analysis, Plotly/table, and real download behavior.

Any mixed build, approval rejection, stale publication, capacity leak, upward
memory drift, unexplained worker exit, raw-data leakage, deletion failure, contract
mismatch, or scientifically invalid result stops progression and triggers rollback.

## 5. Rollback

1. Freeze further traffic progression and new migration contract/drop steps.
2. Reassign the Vercel domain to the last approved deployment identity. Do not
   assume this changes Neon schema, Fly image, environment variables, objects, or
   running jobs.
3. Redeploy Fly API and worker groups from the last approved OCI digest. Keep the
   new build approval revoked through an append-only event; do not edit history.
4. For every running job, either allow completion only when old/new contracts are
   explicitly compatible, fence publication by lease/build identity, or cancel and
   observe child exit and capacity release. Never publish a result across an
   unapproved build boundary.
5. Verify the expanded migration remains backward compatible. Database rollback
   is a separate reviewed operation; never improvise a down migration during an
   application incident.
6. Prove the deletion sweeper, TTL, authenticated not-found probes, event polling,
   and monitoring still run after rollback.
7. Run production readiness, scientific smoke, cancel, deletion and download
   probes against the restored approval. Record the exact old identities and the
   rollback interval in the immutable rollback receipt.

## 6. Contract phase after stability

Only after the new build is fully rolled out, the rollback observation window has
closed, and the owner approves loss of backward compatibility may a separate
reviewed migration contract obsolete columns or behavior. It requires a new Git
commit, migration version, SBOM/schema bundle, `3dena.build-approval.v4`, test matrix,
canary, and rollback plan; it cannot reuse the expand-phase approval.

## 7. Incident rule

An uploaded or derived object still readable at 24 hours is a release/production
incident. Preserve only non-sensitive object hashes, timestamps, build/approval
identities and deletion attempts; do not copy raw bytes into tickets or chat. Stop
new uploads if the sweeper or not-found probe cannot re-establish the approved
retention contract.
