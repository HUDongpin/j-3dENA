# Exact-build release receipts

The final release gate reads `active-release-receipts.json` from this directory.
That file is intentionally absent until independent reviewers have produced every
required immutable receipt against one active signed `BuildApprovalV1`.

Run the contract unit tests with:

```bash
npm run test:release-receipts:unit
```

Run the actual fail-closed gate with:

```bash
npm run test:release-receipts
```

The actual gate requires clean-checkout and SDK consumers; Chromium, Firefox,
Playwright WebKit, real Safari, VoiceOver and NVDA; CodeQL, secret, audit, SBOM,
fuzz, image and legal approvals; isolated preview; real multi-Machine capacity;
two-hour stress and 24-hour soak; ordered 5/25/100 production canary; rollback;
production and deletion probes. Every receipt must bind the same build approval,
use an immutable artifact hash, and be approved outside the implementation roles.
Synthetic unit fixtures are contract tests only and never count as release proof.
