# Compute deployment boundary

This directory is a fail-closed deployment candidate, not a production receipt.

The Docker build requires a reviewed immutable `NODE_BASE_IMAGE` digest that
already contains `/sbin/tini`, a full lowercase `SOURCE_COMMIT`, an explicit
new `output/compute-service-candidate-*` `RUNTIME_BUNDLE_DIR`, and the reviewed
`EXPECTED_SDK_VERSION` plus `EXPECTED_BUILD_ID`, a separately materialized
`BUILD_APPROVAL_PUBLIC_KEYS_DIR`, and its exact
`EXPECTED_BUILD_APPROVAL_PUBLIC_KEYS_SHA256`. The source commit is written to the standard OCI
revision label alongside the fixed `https://github.com/HUDongpin/j-3dENA`
source label; a missing or malformed source commit fails the build. There is no
default runtime bundle that can silently select a tracked historical artifact.
The image consumes only the three prebuilt runtime files from the named
candidate plus the exact canonical Ed25519 public-key registry; it
never copies the repository, oracle
directories, tests, package manager cache, or R material into the runtime
image. The application directory is made non-writable and the runtime user is
numeric UID/GID `10001`. Fly provides the writable ephemeral `/tmp`; no
persistent filesystem volume is mounted.

The entrypoint applies a restrictive umask and hard-fails if the configured
open-file or process limit cannot be applied, if `/app` is writable, if the
approved manifest is unreadable, or if the ephemeral temporary directory is
unwritable. Fly does not currently express a tmpfs mount or a general
read-only-rootfs flag in this checked-in contract; release must verify the
runtime filesystem behavior on the selected Machines platform. This gap is
not converted into a green receipt by the Dockerfile.

`compute-runtime.mjs` and `scientific-worker-entry.mjs` are rebuilt from the
versioned TypeScript sources by `scripts/build-runtime.mjs`. The runtime exposes
two subcommands:

- `api`: adapt `ComputeV1HttpRouter` to Node HTTP on `PORT`;
- `worker`: construct one `PersistentComputeWorker` and run until SIGTERM.

The composition uses a direct Neon endpoint for the persistent worker and a
pooled endpoint for short API transactions. It binds the official Vercel Blob
client through `VercelPrivateBlobClientV1`; secrets remain in the parent process
and are never included in child environment or messages.

Before deployment, integration must:

1. reconstruct the three runtime artifacts from the explicit build input;
2. produce and hash the SBOM;
3. bind `3dena.build-approval.v4` to the Git SHA, Vercel build, Fly image digest,
   migration, schemas, analysis tarball, and jENA successor;
4. provide Fly app and region after confirming the Neon region;
5. configure secrets through Fly, never this file;
6. enforce outbound policy for Neon, Vercel Blob, and approved monitoring;
7. run the image as read-only or equivalently prove non-root write denial,
   `/tmp` bounds, pids, files, memory, and CPU limits;
8. run two-machine lease/restart/deletion probes and container scanning.

For example, after generating a new reviewed candidate directory:

```sh
docker build \
  --build-arg NODE_BASE_IMAGE=registry.example/node-tini@sha256:REPLACE_WITH_64_HEX \
  --build-arg SOURCE_COMMIT=REPLACE_WITH_40_LOWERCASE_HEX \
  --build-arg RUNTIME_BUNDLE_DIR=output/compute-service-candidate-20260825T010000Z \
  --build-arg EXPECTED_SDK_VERSION=0.2.0-implemented-unverified.6 \
  --build-arg EXPECTED_BUILD_ID=REPLACE_WITH_REVIEWED_PUBLIC_BUILD_ID \
  --build-arg BUILD_APPROVAL_PUBLIC_KEYS_DIR=output/build-approval-public-keys-v10 \
  --build-arg EXPECTED_BUILD_APPROVAL_PUBLIC_KEYS_SHA256=REPLACE_WITH_64_LOWERCASE_HEX \
  -f packages/compute-service-persistent/deploy/Dockerfile .
```

The verifier runs before the OCI label can be treated as meaningful and checks
the v4 manifest's clean source commit against `SOURCE_COMMIT`, all six
contracts, all five migrations, dependency pins, exact jENA/SDK/build
identity (including the source-controlled reviewed jENA commit and tarball
integrity), and both bundle digests. The date-like suffix above is an
example release identifier, not a shared mutable directory.

The manual `Exact compute image scan` workflow accepts only an immutable Fly
registry digest, the exact source commit used to build it, and the public-key
registry SHA-256 copied from the independently verified key-materialization
manifest. It does not treat the image's own label as the expected trust root.
It checks out that
commit, records `docker image inspect`, runs the pinned Trivy 0.70.0 image scan,
and issues `3dena.container-scan-receipt.v2` only when the image digest, source
labels, non-root identity, entrypoint, health check, absence of baked credential
variables, exact in-image public-key registry verification, and zero
HIGH/CRITICAL results all pass. The SARIF, inspect document, extracted public
registry, its verification receipt, and scan receipt are retained together as
`trivy-exact-image-evidence`; this does not
replace the independent release review or `3dena.build-approval.v4` binding.

The release command must explicitly scale both groups, for example one API and
at least one worker Machine for initial smoke, followed by the approved
multi-machine capacity matrix. The checked-in file never auto-deploys or
changes account state.

Both API and worker runtime groups must receive the exact lowercase 64-hex
`BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256` from the independently verified
materialization manifest. It is a required V4 readiness identity alongside the
approval manifest and in-image registry hashes; omitting it or supplying a hash
from another materialization lineage makes `/readyz` fail closed. It must be
configured through the deployment environment and never baked into the image.

The candidate `performance-1x`/2 GiB worker size is not approved capacity. A
reviewed calibration may measure whole-container cgroup v2 memory.peak for a
frozen direct-fork harness, but that is neither child-process RSS nor evidence
that the persistent-service API -> queue -> worker path meets its 60-second hard
deadline. Capacity approval still requires that real service path and a
multi-machine matrix on >=2 real Fly Machines; the current Fly status is
`NOT_RUN`.

## Deterministic BuildApproval candidate inputs

The release order is strictly `keys -> image -> candidate`. Public-key registry
materialization cannot depend on a Fly image digest, because the exact registry
must be placed into the image before that image receives its immutable digest.

First, prepare `3dena.build-approval-public-key-materialization-input.v1` with
exactly `schemaVersion` and sorted `publicKeys`. Each entry binds a public-key
ID, reviewer ID, `independent-reviewer` role, sorted allowed environments, and
a portable relative public-PEM `path` with its expected lowercase SHA-256:

```sh
node packages/compute-service-persistent/deploy/materialize-build-approval-public-keys.mjs \
  output/operator-input/build-approval-public-keys-input.json \
  output/build-approval-public-keys-v10

node packages/compute-service-persistent/deploy/verify-build-approval-public-keys.mjs \
  output/build-approval-public-keys-v10/build-approval-public-keys-manifest.json
```

This exclusive-create stage emits only the runtime-compatible canonical
`publicKeyId -> {algorithm, allowedEnvironments, publicKeyPem, reviewerId, role}`
registry and its deterministic source/hash manifest. It rejects private keys,
non-Ed25519 keys, unknown or duplicate fields, unsafe paths, source drift,
output drift, invalid reviewer policy, and extra output files. It needs no
release, Vercel, Fly, image, signature, or activation identity.

Next, the image build must provide that new registry directory and its expected
SHA-256 explicitly. The Docker contract copies only
`build-approval-public-keys.json`, sets `BUILD_APPROVAL_PUBLIC_KEYS_PATH` to the
in-image file, rejects byte drift, non-canonical/non-Ed25519 content, duplicate
fields, or invalid reviewer/role/environment policy, and then makes `/app`
non-writable. Omitting either build argument fails the build. This
closes the source-level image-input contract only; no image exists until a real
independent registry is supplied and a provider returns an immutable digest.
Never use a placeholder key or image digest to bypass the ordering gate.

Only after the registry-containing image has a real immutable digest may
`3dena.build-approval-materialization-input.v1` be prepared. Its exact top-level
fields are `schemaVersion`, `candidate`, `schemaBundle`, and
`publicKeyRegistry`. The latter is the already generated registry's portable
`{path, sha256}` descriptor. Every candidate artifact, migration, schema-index,
schema, and registry reference also carries an explicit expected SHA-256;
unknown or path-only fields are rejected.

```sh
node packages/compute-service-persistent/deploy/materialize-build-approval-inputs.mjs \
  output/operator-input/build-approval-materialization-input.json \
  output/build-approval-materials-v10

node packages/compute-service-persistent/deploy/verify-build-approval-inputs.mjs \
  output/build-approval-materials-v10/build-approval-materialization-manifest.json

node packages/compute-service-persistent/deploy/build-approval-candidate.mjs \
  output/build-approval-materials-v10/build-approval-candidate-input.json \
  REPLACE_WITH_MANIFEST_OUTPUT_CANDIDATE_INPUT_SHA256 \
  output/build-approval-materials-v10/unsigned-candidate.json
```

The candidate materializer writes exactly three exclusive-create files: the
deterministic schema bundle, the hash-pinned candidate CLI input, and its
deterministic manifest. The candidate CLI strictly requires `{path, sha256}`
for every migration and artifact, including the generated schema bundle. It
also requires the candidate-input SHA-256 copied from that manifest, records it
in the unsigned receipt, reads each file once, verifies the expected SHA-256 on
those exact bytes, and
derives every candidate digest and jENA SRI from the same verified buffers. A
change after materialization/verification is rejected without creating an
output; path-only and unknown descriptor fields are also rejected.

None of these commands accepts a private key, creates a signature or reviewer
statement, activates an approval, contacts a provider, or deploys anything.
`unsigned-candidate.json` remains only a candidate receipt until a separate
independent reviewer process signs and activates the exact manifest through the
authorized release procedure.

## BuildApproval and capacity operator pathname custody

Run both operators from an explicit custody root (the CLI uses its current
working directory). Every pathname in the operator config, migration config,
and migration descriptors is relative to that same root. Paths must be portable:
no absolute path, `.` or `..` segment, empty segment, trailing slash, Windows
drive prefix, or backslash is accepted. The operators reject a symbolic link in
either a parent component or leaf, open each leaf with `O_NOFOLLOW`, bound its
bytes before reading, and compare descriptor/path `dev`, `ino`, `size`,
`mtime`, and `ctime` before and after the read. Strict JSON parsing rejects
duplicate keys, including escape-equivalent spellings.

The migration CLI uses the same custody root and requires the independently
pinned migration-config digest. The checked-in example assumes repository root
as custody root, so each migration path starts with
`packages/compute-service-persistent/migrations/`:

```sh
node packages/compute-service-persistent/deploy/migrate.mjs verify \
  packages/compute-service-persistent/deploy/migration-config.example.json \
  REPLACE_WITH_EXTERNALLY_PINNED_MIGRATION_CONFIG_SHA256
```

Use `apply` in place of `verify` only in the separately authorized migration
step. The secure input layer runs before the existing transaction-scoped
advisory lock and does not change apply/verify transaction semantics.

BuildApproval activation or verification accepts this exact config shape:

```json
{
  "schemaVersion": "3dena.build-approval-operator.v1",
  "operation": "verify",
  "environment": "preview",
  "migrationConfigPath": "output/operator/migration-config.json",
  "migrationConfigSha256": "REPLACE_WITH_64_LOWERCASE_HEX",
  "signedApprovalPath": "output/operator/signed-build-approval.json",
  "signedApprovalSha256": "REPLACE_WITH_64_LOWERCASE_HEX",
  "publicKeysPath": "output/operator/build-approval-public-keys.json",
  "publicKeysSha256": "REPLACE_WITH_64_LOWERCASE_HEX"
}
```

The three hashes after the config pathname are mandatory external pins. They
must come from the independently approved release handoff, not be computed from
the files being verified by the same invocation:

```sh
node packages/compute-service-persistent/deploy/build-approval-operator.mjs \
  output/operator/build-approval-operator.json \
  REPLACE_WITH_EXTERNALLY_PINNED_CONFIG_SHA256 \
  REPLACE_WITH_EXTERNALLY_PINNED_SIGNED_APPROVAL_SHA256 \
  REPLACE_WITH_EXTERNALLY_PINNED_PUBLIC_KEY_REGISTRY_SHA256
```

The config repeats the signed-approval and registry digests and pins the
migration-config bytes. The signed V4 candidate independently binds the
migration manifest and public-key registry. Consequently, replacing a matching
config, approval, and registry together cannot make a new trust root
self-authenticating: the external pins still have to match.

Capacity apply or verification uses the same custody contract. Its config is:

```json
{
  "schemaVersion": "3dena.compute-capacity-operator.v1",
  "operation": "verify",
  "expectedCapacity": 2,
  "migrationConfigPath": "output/operator/migration-config.json",
  "migrationConfigSha256": "REPLACE_WITH_64_LOWERCASE_HEX",
  "buildReadiness": {
    "environment": "preview",
    "approvalManifestSha256": "REPLACE_WITH_64_LOWERCASE_HEX",
    "publicKeysPath": "output/operator/build-approval-public-keys.json",
    "publicKeysSha256": "REPLACE_WITH_64_LOWERCASE_HEX"
  }
}
```

The capacity CLI requires external pins for the config, the active approval
manifest, and the reviewer registry, in that order:

```sh
node packages/compute-service-persistent/deploy/capacity-operator.mjs \
  output/operator/capacity-operator.json \
  REPLACE_WITH_EXTERNALLY_PINNED_CONFIG_SHA256 \
  REPLACE_WITH_EXTERNALLY_PINNED_APPROVAL_MANIFEST_SHA256 \
  REPLACE_WITH_EXTERNALLY_PINNED_PUBLIC_KEY_REGISTRY_SHA256
```

The approval-manifest pin is checked against both the config and the latest
active, non-revoked database approval before capacity can be changed. A failed
path, byte, signature, registry, migration, or approval binding occurs before
any capacity mutation.
