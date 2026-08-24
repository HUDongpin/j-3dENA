BEGIN;

ALTER TABLE compute_capacity_slots
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_receipt jsonb;

ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS claim_slot_number integer,
  ADD COLUMN IF NOT EXISTS claim_fencing_epoch bigint;

CREATE TABLE IF NOT EXISTS compute_scheduler_leases (
  lease_name text PRIMARY KEY,
  holder_id text NOT NULL,
  lease_epoch bigint NOT NULL CHECK (lease_epoch > 0),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS compute_termination_reconciliation_receipts (
  task_ref text NOT NULL CHECK (task_ref ~ '^[a-f0-9]{64}$'),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 0),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  reconciled_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN (
    'owning-worker','external-quarantine-reconcile','expired-claim-recovery'
  )),
  provider_receipt_id text,
  observation jsonb,
  receipt jsonb NOT NULL,
  PRIMARY KEY (task_ref, lease_epoch, fencing_epoch)
);

CREATE UNIQUE INDEX IF NOT EXISTS compute_termination_provider_receipt_idx
  ON compute_termination_reconciliation_receipts(provider_receipt_id)
  WHERE provider_receipt_id IS NOT NULL;

ALTER TABLE compute_objects
  ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fencing_epoch bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS intent_at timestamptz,
  ADD COLUMN IF NOT EXISTS available_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleting_at timestamptz;

UPDATE compute_objects SET
  state = CASE WHEN deleted_at IS NULL THEN 'available' ELSE 'deleted' END,
  available_at = CASE WHEN deleted_at IS NULL THEN COALESCE(available_at, created_at) ELSE available_at END
WHERE state = 'available';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compute_objects_generation_positive'
  ) THEN
    ALTER TABLE compute_objects ADD CONSTRAINT compute_objects_generation_positive
      CHECK (generation > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compute_objects_fencing_epoch_positive'
  ) THEN
    ALTER TABLE compute_objects ADD CONSTRAINT compute_objects_fencing_epoch_positive
      CHECK (fencing_epoch > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compute_objects_state_check'
  ) THEN
    ALTER TABLE compute_objects ADD CONSTRAINT compute_objects_state_check
      CHECK (state IN ('intent','available','deleting','deleted'));
  END IF;
END
$$;

DROP INDEX IF EXISTS compute_objects_due_idx;
CREATE INDEX compute_objects_due_state_idx
  ON compute_objects (delete_after, object_ref)
  WHERE state <> 'deleted';

CREATE TABLE IF NOT EXISTS compute_blob_namespace_locks (
  namespace text PRIMARY KEY,
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS compute_blob_orphan_intents (
  pathname text PRIMARY KEY,
  namespace text NOT NULL,
  object_ref text NOT NULL CHECK (object_ref ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL CHECK (generation > 0),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  state text NOT NULL CHECK (state IN ('deleting','deleted')),
  provider_uploaded_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL,
  completed_at timestamptz,
  receipt jsonb
);

CREATE INDEX IF NOT EXISTS compute_blob_orphan_due_idx
  ON compute_blob_orphan_intents (namespace, discovered_at, pathname)
  WHERE state = 'deleting';

ALTER TABLE compute_recovery_receipts
  DROP CONSTRAINT IF EXISTS compute_recovery_receipts_disposition_check;

ALTER TABLE compute_recovery_receipts
  ADD CONSTRAINT compute_recovery_receipts_disposition_check
  CHECK (disposition IN ('ack_replayed','cancelled','expired','quarantined','requeued','timed_out'));

ALTER TABLE compute_build_approvals
  DROP CONSTRAINT IF EXISTS compute_build_approvals_approval_check;

ALTER TABLE compute_build_approvals
  ADD CONSTRAINT compute_build_approvals_approval_check
  CHECK (approval->>'version' IN ('3dena.build-approval.v1','3dena.build-approval.v2'));

CREATE TABLE IF NOT EXISTS compute_orphan_reconciliation_receipts (
  object_ref text PRIMARY KEY CHECK (object_ref ~ '^[a-f0-9]{64}$'),
  provider_uploaded_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  receipt jsonb NOT NULL,
  CHECK (receipt->>'version' = '3dena.orphan-reconciliation-receipt.v1')
);

COMMIT;
