# GitHub security settings release gate

Status: `IMPLEMENTED_UNVERIFIED` until an authorized remote exists and its owner
supplies current settings receipts.

The repository workflows provide pinned CodeQL and Trivy vulnerability, secret,
and misconfiguration scans. They do not have authority to enable organization or
repository settings. Before a release reviewer may issue the `secret-scan` and
`codeql` release receipts, the authorized GitHub owner must also verify:

- GitHub Advanced Security/code scanning is enabled for the release repository;
- secret scanning and push protection are enabled, including non-provider and
  generic-secret protection where the account supports them;
- bypass is restricted, reviewable, and has no unresolved release-SHA bypass;
- branch protection requires CI, CodeQL, and repository-security scan checks;
- workflow tokens use least privilege and no long-lived production credential is
  stored as a repository variable, artifact, cache, log, or source file;
- Dependabot/security update alerts are enabled and reviewed for the exact lock;
- the immutable workflow action-pin gate passes for the release commit.

The owner receipt must bind the repository identity, settings snapshot hash,
release Git SHA, reviewer, UTC time, and the same `BuildApprovalV1` manifest hash.
Screenshots alone do not satisfy the setting or scan receipts. Until a remote is
authorized and these controls are observed, push protection remains an explicit
external release blocker.
