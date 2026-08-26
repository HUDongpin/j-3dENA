BEGIN;

ALTER TABLE compute_build_approvals
  DROP CONSTRAINT IF EXISTS compute_build_approvals_approval_check;

-- V1-V3 remain readable immutable history. Only V4 is accepted by current
-- runtime/operator validation and can become the latest active approval.
ALTER TABLE compute_build_approvals
  ADD CONSTRAINT compute_build_approvals_approval_check
  CHECK (approval->>'version' IN (
    '3dena.build-approval.v1',
    '3dena.build-approval.v2',
    '3dena.build-approval.v3',
    '3dena.build-approval.v4'
  ));

COMMIT;
