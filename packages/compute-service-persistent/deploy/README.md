# Compute deployment boundary

This directory is a fail-closed deployment candidate, not a production receipt.

The Docker build requires a reviewed immutable `NODE_BASE_IMAGE` digest that
already contains `/sbin/tini` and a full lowercase `SOURCE_COMMIT` build
argument. The latter is written to the standard OCI revision label alongside
the fixed `https://github.com/HUDongpin/j-3dENA` source label; a missing or
malformed source commit fails the build. The image consumes only three prebuilt
files from `output/compute-service`; it never copies the repository, oracle
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
3. bind `BuildApprovalV1` to the Git SHA, Vercel build, Fly image digest,
   migration, schemas, analysis tarball, and jENA successor;
4. provide Fly app and region after confirming the Neon region;
5. configure secrets through Fly, never this file;
6. enforce outbound policy for Neon, Vercel Blob, and approved monitoring;
7. run the image as read-only or equivalently prove non-root write denial,
   `/tmp` bounds, pids, files, memory, and CPU limits;
8. run two-machine lease/restart/deletion probes and container scanning.

The manual `Exact compute image scan` workflow accepts only an immutable Fly
registry digest and the exact source commit used to build it. It checks out that
commit, records `docker image inspect`, runs the pinned Trivy 0.70.0 image scan,
and issues `3dena.container-scan-receipt.v1` only when the image digest, source
labels, non-root identity, entrypoint, health check, absence of baked credential
variables, and zero HIGH/CRITICAL results all pass. The SARIF, inspect document,
and receipt are retained together as `trivy-exact-image-evidence`; this does not
replace the independent release review or BuildApprovalV1 binding.

The release command must explicitly scale both groups, for example one API and
at least one worker Machine for initial smoke, followed by the approved
multi-machine capacity matrix. The checked-in file never auto-deploys or
changes account state.

The candidate `performance-1x`/2 GiB worker size is not approved capacity. The
release calibration must demonstrate one child peak RSS below 50% or change it.
