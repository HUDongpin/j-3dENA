# Legal and data-processing release checklist

Status: `IMPLEMENTED_UNVERIFIED`; independent counsel/authorized legal reviewer
approval is absent. This checklist is an evidence contract, not legal approval.

## Distribution and source availability

- Confirm the repository root, Web build, Fly image, and public package all carry
  the complete unmodified GPL version 3 text selected by the project owner.
- Reconcile the exact production lock/SBOM against notices. Include jENA's exact
  reviewed successor version, commit, registry tarball hash, GPL notice, source
  repository, and corresponding-source availability.
- Include SheetJS CE 0.20.3's Apache-2.0 license and the vendored tarball identity
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`.
- Review every remaining production dependency's exact license disposition and
  preserve notices required by the generated full lock-graph SBOM.
- Identify every copied, translated, generated, or structurally derived legacy,
  rENA, documentation, fixture, schema, and visual asset. Record its source SHA,
  license, transformation, and approved distribution disposition.
- Verify that the public source location corresponds to the distributed binaries
  and remains available for the required period. A local checkout or private
  candidate tarball is not source availability for a public distribution.

## Data processors, regions, and retention

- Bind the production Vercel project, Neon project/branch, Fly application and
  Machines, and private Blob or S3/KMS store to their legal account identities,
  data-processing terms, subprocessors, and approved region.
- Confirm Vercel Private Blob's then-current private-access, encryption, cache,
  deletion, beta, and regional behavior in a controlled acceptance. If any item
  is not approved, record the fail-closed switch to the reviewed same-region
  S3/KMS adapter; long-term Class 1 custody uses its separately reviewed store.
- Confirm raw uploads and derived objects are deleted after terminal publication,
  with the exception path capped at 24 hours and authenticated not-found probes.
- Confirm aggregate-only operational telemetry excludes raw rows, participant
  IDs, file names, code content, study titles, research context, and user text.
- Confirm Class 1 custody authorization, de-identification, allowed use, access
  isolation, retention, deletion, and any WORM/Object Lock requirement separately
  from ordinary production uploads.
- Confirm the upload consent language accurately states processor, region,
  server-side processing, retention, deletion behavior, and support contact.

## Required approval receipt

The legal reviewer must be outside implementation roles. The immutable receipt
must bind the release Git SHA, complete lockfile, SBOM, notice bundle, public
package tarball, jENA successor, Web deployment, Fly image digest, migration,
data-processor/region decisions, source-availability URL or offer, reviewer,
decision, UTC time, and the active signed `3dena.build-approval.v4` manifest hash.

Any unresolved dependency, missing source, unapproved rENA-derived material,
processor/region ambiguity, private-storage beta concern, or retention mismatch
keeps the `license-legal` release receipt absent and the release gate closed.
