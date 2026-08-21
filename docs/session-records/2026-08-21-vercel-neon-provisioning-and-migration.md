# 2026-08-21 — Vercel/Neon provisioning and migration execution

## Outcome

The Owner-controlled Vercel project `j-3dena` is connected to the Owner's
GitHub repository `HUDongpin/j-3dENA`. Its Neon Marketplace resource
`j-3dena-postgres-sin1` is a Launch-plan project in AWS Asia Pacific 1
(Singapore). Production and Preview environment bindings exist in Vercel and
their secret values were neither revealed nor copied during this execution.

The reviewed expand migration at
`packages/compute-service-persistent/migrations/0001_persistent_compute.sql`
was executed on Neon project `frosty-recipe-69276050`, branch `main`, database
`neondb`, through the Neon SQL Editor opened by Vercel SSO. Vercel's connection
is configured to require an active resource before deploy, keep injected values
sensitive, and create a Neon branch for Preview deployments only; Production
branch creation remains off. The source was the
10,002-byte file at Git commit
`f6cf1dca0a77e0ceb05e6f2ef53645e7cb0cc0a8`, with SHA-256
`2ada0828852d69dfebfaf3da96d41ba69dd91b522117fd868fad1665239e568e`.

All 39 submitted statements completed successfully: 37 migration statements,
one migration-registry insert, and one verification query. The provider-side
verification at `2026-08-21T07:23:28.456949Z` returned exactly one migration
row, the expected version and hash, 17 `compute_*` tables, database `neondb`,
PostgreSQL `18.6 (3484359)`, and server timezone `GMT`.

## Control probes

Two non-destructive probes then ran on the same target:

1. an attempted update of the migration registry was accepted by the probe only
   when the installed append-only trigger raised the exact rejection; the
   migration row and hash remained unchanged; and
2. a sentinel distributed-capacity row was inserted inside a transaction and
   rolled back; a final independent query returned zero sentinel rows.

An isolated Neon child branch, `codex-rollback-probe-20260821`
(`br-damp-rain-b37llxmu`), was then forked from `main` in 1.35 seconds with a
one-day auto-delete deadline. A sentinel capacity row existed on the child at
`2026-08-21T07:28:16.349282Z`, while `main` returned zero copies of that row at
`2026-08-21T07:29:00.703456Z`. Neon `Reset from parent` removed the child row;
the child returned zero at `2026-08-21T07:30:41.536329Z` and retained the exact
migration version/hash. The child branch was then permanently deleted and the
project returned to one branch, `main`. Only the test branch and sentinel were
deleted; the production schema was not dropped or reset.

The structured execution record is
`evidence/cloud/2026-08-21-neon-migration-execution.json`.

## Evidence boundary

This closes the technical first-migration, database transaction/immutability,
and manual child-branch isolation/reset/deletion probes only. The operator is
the implementation operator, so this is not independent approval, a provider-
signed immutable receipt, a legal/DPA region approval, or a signed
`BuildApprovalV1`. Vercel Preview branch creation is enabled, but the automatic
branch from a subsequent exact preview deployment still requires live
observation and is not yet an independently approved staging build. Two real
Fly Machines, object storage,
restart/capacity/TTL/object-deletion probes, stress, soak, canary, production
probes, and the same-BuildApproval full rollback drill remain open. The overall
product state remains `IMPLEMENTED_UNVERIFIED`.
