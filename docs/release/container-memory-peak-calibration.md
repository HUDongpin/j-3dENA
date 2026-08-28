# Exact v12 whole-container memory-peak calibration

Status: **NOT_RUN**.

This change contains a reviewable runner, strict verifier, frozen request, and
manually dispatched GitHub Actions workflow. It contains no result from an
executed Linux container, no uploaded evidence artifact, no GitHub artifact
attestation, and no Fly Machine measurement. It therefore makes no present
capacity, deployment-readiness, production-readiness, or multi-machine claim.

## What the future measurement means

The Linux measurement is cgroup v2 `memory.peak` for the **whole container**.
It conservatively includes the scientific child, the calibration runner,
`tini`, page cache, and other memory charged to the container cgroup. It is not
the scientific child process's RSS, and it is not equivalent to the retained
macOS `ps` process-RSS preflight. The formal threshold, if the workflow is
successfully executed and independently verified, is the maximum of three raw
whole-container peaks divided by the measured `memory.max` of `2147483648`;
that fraction must be no greater than `0.5`.

The approved calibration envelope is frozen at 240 rows, two groups, 20
participants per group, six periods, eight codes, 500 permutation repetitions,
500 participant-history bootstrap repetitions, four inference families, and
one network overlay. `approvedCalibrationEnvelopeOnly` remains true and no
larger workload may be inferred from this calibration. The immutable request
still contains the legacy operational identifier `rss-calibration-v12`; that
identifier does not change the measurement into process RSS.

## Evidence and publication gates

The producer job is designed to run exactly three fresh Docker containers from
the immutable image digest. It rereads every raw run, runtime inspect document,
stdout/stderr marker, and scientific artifact. Its first receipt is explicitly
`consistency-passed` with both formal approval fields false. Synthetic tests can
only produce a `test-only-consistency-pass` receipt.

Only a second protected GitHub job may issue the formal schema. That job must
download the producer artifact by numeric artifact ID, enforce the upload
digest, reproduce the consistency receipt from the raw files, bind repository,
ref, workflow SHA, run ID, run attempt, producer/verifier jobs, protected
environment, artifact ID/digest/URL, and consistency-receipt SHA-256, and have
GitHub-hosted OIDC request capability. Before reading the candidate receipt,
the formalizer must make a live authenticated HTTPS exchange with the fixed
`vstoken.actions.githubusercontent.com` origin and validate the returned
short-lived token's issuer, audience, protected-environment subject,
repository, ref, tooling/workflow SHA, run ID/attempt, event, and hosted-runner
claims. The receipt retains only those selected claims and the token SHA-256,
never the bearer token. An offline synthetic fixture or a process that merely
spoofs GitHub environment variables cannot use the public formalizer to issue a
formal receipt.

The producer also records the observed GitHub runner image name/version,
Linux kernel release/version, Docker client/server versions, and cgroup
filesystem. Those fields document the otherwise moving `ubuntu-latest`
execution surface; they are provenance, not a claim that the runner image is an
immutable external trust root.

The evidence artifact is a strict closed set. The downloaded scan is staged
under the runner's temporary directory, copied only after hash/identity checks,
and deleted before upload. Undeclared files, directories, symbolic links,
hard links, non-regular files, path escapes, and cumulative evidence beyond the
fixed byte budget fail verification, and the cumulative budget is checked
before allocating each next file. Receipts are written to a same-directory
temporary inode, fully reread, and atomically linked without overwrite. That
exclusive link is the one-way commit point: prepublication failures prove the
destination absent, while a later temporary-file cleanup or directory-fsync
diagnostic is surfaced as a warning and cannot leave a failing process beside
a visible PASS receipt.

## Isolation and secret boundary

The producer contract fixes Linux/amd64, cgroup v2, runtime user `10001:10001`,
2 GiB `memory.max`, zero `memory.swap.max`, one CPU, 64 pids, read-only root,
no network, no new privileges, all capabilities dropped, and `/tmp` mounted as
`rw,nosuid,nodev,noexec`. Runtime inspect must additionally show
`Privileged=false`, no added capabilities, no undeclared binds/mounts/devices,
the exact PID/IPC/user/cgroup namespace modes, and the exact `tini` entrypoint
and pinned runner command.

Each container receives exactly two mounts: one immutable, separately staged
input root at `/calibration`, and one new empty per-run writable output root at
`/evidence`. The writable root may not equal, contain, or be contained by the
input root, and no run can see a previous run's output. Container IDs, runtime
inspect, Docker client logs, and the authoritative host-side cgroup observation
are staged outside both mounts and copied into the closed evidence tree only
after all three stopped containers are removed and the exact file sets are
checked.

The private registry requires `FLY_API_TOKEN`. The workflow confines it to one
fixed login-and-pull step using a freshly created `DOCKER_CONFIG`, then logs out,
deletes that directory, and proves it absent before any repository script is
executed. The default Docker credential store is not used. The workflow does
not start a Fly Machine.

Because this workflow has not run, Docker-daemon behavior for the requested
swappiness value, tmpfs option representation/order, namespace defaults, and
other runtime-inspect fields remains **NOT_RUN** rather than verified. Static
workflow tests only establish the intended command contract.

## Explicitly excluded evidence

The original macOS/arm64 host receipt hash remains frozen at
`d9b0d03edbc1d25858a4b433fb0dee687492e5632a5146dc8158d2c3c051cf49`
and is informational-only. The original file contains local absolute paths and
process identifiers and is therefore intentionally not stored in the public
repository or uploaded artifact. The repository contains only a redacted
derivative that removes those fields and binds the original hash. Neither its
value nor its status contributes to the Linux calculation; the legacy source
schema is not an alias for the formal whole-container measurement.

Three fresh Docker containers are not three Fly Machines. Even after a future
formal container artifact passes, `realFlyMultiMachineApproved` remains false
and `realFlyMultiMachineStatus` remains **NOT_RUN**. Final capacity closure
still requires successful same-identity evidence from >=2 real Fly Machines.
