# Exact-build release receipts

The final release gate reads `active-release-receipts.json` from this directory.
That file is intentionally absent until independent reviewers have produced every
required immutable receipt against one active signed `3dena.build-approval.v4`
and an independent reviewer has signed the final
`3dena.release-receipts.v2` matrix.

Run the contract unit tests with:

```bash
npm run test:release-receipts:unit
```

Run the actual fail-closed gate with:

```bash
RELEASE_EXPECTED_PUBLIC_KEY_REGISTRY_SHA256=<protected-registry-sha256> \
RELEASE_ALLOWED_PUBLIC_KEY_ID=<protected-public-key-id> \
RELEASE_ALLOWED_REVIEWER_ID=<protected-reviewer-id> \
  npm run test:release-receipts
```

Those three values are release-policy inputs from outside the evidence bundle;
the verifier must never derive them from `active-release-receipts.json` or its
raw registry. Equivalent repeatable CLI flags are
`--expected-public-key-registry-sha256`, `--allowed-public-key-id`, and
`--allowed-reviewer-id`.

The actual gate requires clean-checkout and SDK consumers; Chromium, Firefox,
Playwright WebKit, real Safari, VoiceOver and NVDA; CodeQL, secret, audit, SBOM,
fuzz, image and legal approvals; isolated preview; real multi-Machine capacity;
two-hour stress and 24-hour soak; ordered 5/25/100 production canary; rollback;
production and deletion probes. Every receipt must bind the same build approval,
use an immutable artifact hash, and be approved outside the implementation roles.
The V2 gate securely rereads the raw signed build approval, rich Ed25519 registry,
the complete reproducible materialization directory, exact-image scan v3 receipt,
Docker inspect, raw in-image registry, registry-verification and Trivy JSON
children. It cross-binds the externally pinned registry, signed candidate,
image/source identity, authority-specific deployment/build IDs, and bounded raw
production `/readyz` response before verifying a second Ed25519 approval over
the canonical final receipt matrix after every receipt has completed.

The materialization/release verifier shares the versioned
`3dena.build-approval-artifact-bounds.v1` contract: analysis tarball 32 MiB,
Jena tarball 8 MiB, lockfile 4 MiB, SBOM 16 MiB, each migration and schema index
1 MiB, each schema document 4 MiB, generated schema bundle 32 MiB, and generated
candidate input/materialization input/materialization manifest 4 MiB each. The
public-key registry remains capped at 128 KiB. Files are size-checked from the
securely opened descriptor before their contents are read or hashed.
Synthetic unit fixtures are contract tests only and never count as release proof.

`2026-08-21-exact-head-ci-preview-candidate.json` records the successful
`e8f0884` GitHub CI/security/browser matrix and the matching authenticated
Vercel dashboard provenance. It is implementation-operator candidate evidence,
not an active release receipt: the access-protected Preview runtime was not
probed, and no independent approval or signed `3dena.build-approval.v4` plus
`3dena.release-receipts-approval.v1` binds it.
