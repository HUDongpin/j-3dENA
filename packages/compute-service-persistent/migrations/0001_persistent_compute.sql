BEGIN;

CREATE TABLE IF NOT EXISTS compute_schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS compute_jobs (
  task_id text PRIMARY KEY,
  task_ref text NOT NULL UNIQUE CHECK (task_ref ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  CHECK (record->>'version' = '3dena.compute-job-record.v1'),
  CHECK (record->'owner'->>'taskId' = task_id),
  CHECK ((record->>'revision')::bigint = revision),
  CHECK (record->>'state' = state)
);

CREATE INDEX IF NOT EXISTS compute_jobs_claimable_idx
  ON compute_jobs (created_at, task_id)
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS compute_jobs_expiry_idx
  ON compute_jobs (expires_at, deadline_at)
  WHERE state <> 'deleted';

CREATE TABLE IF NOT EXISTS compute_http_jobs (
  job_id text PRIMARY KEY,
  create_idempotency_hash text NOT NULL UNIQUE CHECK (create_idempotency_hash ~ '^[a-f0-9]{64}$'),
  create_request_fingerprint text NOT NULL CHECK (create_request_fingerprint ~ '^[a-f0-9]{64}$'),
  capability_hash text NOT NULL CHECK (capability_hash ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  CHECK (record->>'version' = '3dena.compute-http-job.v1'),
  CHECK (record->>'jobId' = job_id),
  CHECK ((record->>'revision')::bigint = revision)
);

CREATE TABLE IF NOT EXISTS compute_capacity_slots (
  slot_number integer PRIMARY KEY CHECK (slot_number > 0),
  enabled boolean NOT NULL DEFAULT true,
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  holder_id text,
  task_id text REFERENCES compute_jobs(task_id),
  lease_id text,
  lease_epoch bigint,
  heartbeat_at timestamptz,
  expires_at timestamptz,
  CHECK (
    (holder_id IS NULL AND task_id IS NULL AND lease_id IS NULL AND lease_epoch IS NULL AND heartbeat_at IS NULL AND expires_at IS NULL)
    OR
    (holder_id IS NOT NULL AND task_id IS NOT NULL AND lease_id IS NOT NULL AND lease_epoch IS NOT NULL AND heartbeat_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS compute_capacity_one_task_idx
  ON compute_capacity_slots(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS compute_event_cursors (
  job_id text PRIMARY KEY,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0)
);

CREATE TABLE IF NOT EXISTS compute_events (
  job_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  emitted_at timestamptz NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (job_id, sequence),
  CHECK (event->>'schemaVersion' = '3dena.job-event.v1'),
  CHECK ((event->>'sequence')::bigint = sequence)
);

CREATE TABLE IF NOT EXISTS compute_recovery_receipts (
  task_ref text NOT NULL CHECK (task_ref ~ '^[a-f0-9]{64}$'),
  previous_lease_epoch bigint NOT NULL CHECK (previous_lease_epoch >= 0),
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch > 0),
  recovered_at timestamptz NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('ack_replayed','cancelled','expired','requeued','timed_out')),
  receipt jsonb NOT NULL,
  PRIMARY KEY (task_ref, previous_lease_epoch, fencing_epoch)
);

CREATE TABLE IF NOT EXISTS compute_audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_ref text NOT NULL CHECK (task_ref ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL,
  state text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event jsonb NOT NULL,
  CHECK (event->>'version' = '3dena.compute-audit-event.v1'),
  CHECK (event->>'taskRef' = task_ref),
  CHECK (event->>'kind' = kind),
  CHECK (event->>'state' = state)
);

CREATE INDEX IF NOT EXISTS compute_audit_events_task_idx
  ON compute_audit_events(task_ref, event_id);

CREATE TABLE IF NOT EXISTS compute_deletion_receipts (
  object_ref text NOT NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  receipt jsonb NOT NULL,
  PRIMARY KEY (object_ref, requested_at)
);

CREATE TABLE IF NOT EXISTS compute_objects (
  object_ref text PRIMARY KEY CHECK (object_ref ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE,
  pathname text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  created_at timestamptz NOT NULL,
  delete_after timestamptz NOT NULL,
  deleted_at timestamptz,
  deletion_receipt jsonb
);

CREATE INDEX IF NOT EXISTS compute_objects_due_idx
  ON compute_objects (delete_after) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS compute_build_approvals (
  approval_manifest_sha256 text PRIMARY KEY CHECK (approval_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  release_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('preview','production')),
  git_commit text NOT NULL CHECK (git_commit ~ '^[a-f0-9]{40}$'),
  vercel_deployment_id text NOT NULL,
  vercel_build_id text NOT NULL,
  fly_image_digest text NOT NULL CHECK (fly_image_digest ~ '^sha256:[a-f0-9]{64}$'),
  fly_build_id text NOT NULL,
  reviewer_id text NOT NULL,
  approved_at timestamptz NOT NULL,
  approval jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (approval->>'version' = '3dena.build-approval.v1')
);

CREATE TABLE IF NOT EXISTS compute_build_approval_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_manifest_sha256 text NOT NULL REFERENCES compute_build_approvals(approval_manifest_sha256),
  environment text NOT NULL CHECK (environment IN ('preview','production')),
  event_type text NOT NULL CHECK (event_type IN ('activated','revoked')),
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (approval_manifest_sha256, event_type, actor_id, occurred_at)
);

CREATE INDEX IF NOT EXISTS compute_build_approval_events_environment_idx
  ON compute_build_approval_events(environment, event_id DESC);

CREATE TABLE IF NOT EXISTS compute_scientific_results (
  result_hash text PRIMARY KEY CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  spec_hash text NOT NULL CHECK (spec_hash ~ '^[a-f0-9]{64}$'),
  build_id text NOT NULL,
  task_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  object_byte_length bigint NOT NULL CHECK (object_byte_length > 0),
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > published_at),
  publication_receipt jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS compute_scientific_results_dataset_idx
  ON compute_scientific_results(dataset_hash, result_hash);

CREATE TABLE IF NOT EXISTS compute_rate_limit_windows (
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  route_class text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_hash, route_class, window_start)
);

CREATE INDEX IF NOT EXISTS compute_rate_limit_windows_expiry_idx
  ON compute_rate_limit_windows(expires_at);

CREATE TABLE IF NOT EXISTS compute_dataset_workflows (
  dataset_id text PRIMARY KEY,
  generation bigint NOT NULL CHECK (generation >= 0),
  revision bigint NOT NULL CHECK (revision >= 0),
  session jsonb NOT NULL,
  control_state jsonb NOT NULL,
  active_record jsonb,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS compute_dataset_workflows_expiry_idx
  ON compute_dataset_workflows(expires_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS compute_dataset_artifacts (
  dataset_id text NOT NULL REFERENCES compute_dataset_workflows(dataset_id),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('upload','parsed')),
  artifact_identity text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dataset_id, artifact_kind, artifact_identity)
);

CREATE TABLE IF NOT EXISTS compute_dataset_deletion_receipts (
  dataset_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION reject_compute_build_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compute build approval history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS compute_schema_migrations_immutable ON compute_schema_migrations;
CREATE TRIGGER compute_schema_migrations_immutable
BEFORE UPDATE OR DELETE ON compute_schema_migrations
FOR EACH ROW EXECUTE FUNCTION reject_compute_build_history_mutation();

DROP TRIGGER IF EXISTS compute_build_approvals_immutable ON compute_build_approvals;
CREATE TRIGGER compute_build_approvals_immutable
BEFORE UPDATE OR DELETE ON compute_build_approvals
FOR EACH ROW EXECUTE FUNCTION reject_compute_build_history_mutation();

DROP TRIGGER IF EXISTS compute_build_approval_events_immutable ON compute_build_approval_events;
CREATE TRIGGER compute_build_approval_events_immutable
BEFORE UPDATE OR DELETE ON compute_build_approval_events
FOR EACH ROW EXECUTE FUNCTION reject_compute_build_history_mutation();

DROP TRIGGER IF EXISTS compute_scientific_results_immutable ON compute_scientific_results;
CREATE TRIGGER compute_scientific_results_immutable
BEFORE UPDATE OR DELETE ON compute_scientific_results
FOR EACH ROW EXECUTE FUNCTION reject_compute_build_history_mutation();

COMMIT;
