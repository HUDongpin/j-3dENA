BEGIN;

ALTER TABLE compute_build_approvals
  DROP CONSTRAINT IF EXISTS compute_build_approvals_approval_check;

ALTER TABLE compute_build_approvals
  ADD CONSTRAINT compute_build_approvals_approval_check
  CHECK (approval->>'version' IN (
    '3dena.build-approval.v1',
    '3dena.build-approval.v2',
    '3dena.build-approval.v3'
  ));

COMMIT;
