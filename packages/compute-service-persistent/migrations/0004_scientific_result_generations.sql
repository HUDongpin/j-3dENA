BEGIN;

-- Immutable publication evidence is separate from the short-lived lookup
-- pointer. A result hash may therefore have multiple audited generations,
-- while only one unexpired generation can be active at a time.
CREATE TABLE IF NOT EXISTS compute_scientific_result_publications (
  publication_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL CHECK (generation > 0),
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  spec_hash text NOT NULL CHECK (spec_hash ~ '^[a-f0-9]{64}$'),
  build_id text NOT NULL,
  task_id text NOT NULL,
  object_key text NOT NULL,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  object_byte_length bigint NOT NULL CHECK (object_byte_length > 0),
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > published_at),
  publication_receipt jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (result_hash, generation),
  UNIQUE (publication_id, result_hash, expires_at)
);

CREATE INDEX IF NOT EXISTS compute_scientific_result_publications_dataset_idx
  ON compute_scientific_result_publications(dataset_hash, result_hash, generation DESC);

CREATE TABLE IF NOT EXISTS compute_scientific_result_active (
  result_hash text PRIMARY KEY CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  publication_id bigint NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (publication_id, result_hash, expires_at)
    REFERENCES compute_scientific_result_publications(
      publication_id, result_hash, expires_at
    )
);

CREATE INDEX IF NOT EXISTS compute_scientific_result_active_expiry_idx
  ON compute_scientific_result_active(expires_at, result_hash);

-- Establish the compatibility bridge before taking the backfill snapshot.
-- CREATE TRIGGER locks the legacy table until this transaction commits: rows
-- committed before the lock are seen by the later backfill, while an in-flight
-- 0001 writer unblocked after commit is mirrored by this trigger.
CREATE OR REPLACE FUNCTION mirror_compute_scientific_result_generation_one()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mirrored_publication_id bigint;
BEGIN
  INSERT INTO compute_scientific_result_publications (
    result_hash, generation, dataset_hash, spec_hash, build_id, task_id,
    object_key, object_sha256, object_byte_length, published_at, expires_at,
    publication_receipt
  ) VALUES (
    NEW.result_hash, 1, NEW.dataset_hash, NEW.spec_hash, NEW.build_id,
    NEW.task_id, NEW.object_key, NEW.object_sha256, NEW.object_byte_length,
    NEW.published_at, NEW.expires_at, NEW.publication_receipt
  )
  ON CONFLICT (result_hash, generation) DO NOTHING;

  SELECT publication_id INTO mirrored_publication_id
  FROM compute_scientific_result_publications
  WHERE result_hash = NEW.result_hash
    AND generation = 1
    AND dataset_hash = NEW.dataset_hash
    AND spec_hash = NEW.spec_hash
    AND build_id = NEW.build_id
    AND task_id = NEW.task_id
    AND object_key = NEW.object_key
    AND object_sha256 = NEW.object_sha256
    AND object_byte_length = NEW.object_byte_length
    AND published_at = NEW.published_at
    AND expires_at = NEW.expires_at
    AND publication_receipt = NEW.publication_receipt;
  IF mirrored_publication_id IS NULL THEN
    RAISE EXCEPTION 'legacy scientific result conflicts with generation history';
  END IF;

  IF NEW.expires_at > clock_timestamp() THEN
    INSERT INTO compute_scientific_result_active (
      result_hash, publication_id, expires_at
    ) VALUES (
      NEW.result_hash, mirrored_publication_id, NEW.expires_at
    )
    ON CONFLICT (result_hash) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM compute_scientific_result_active
      WHERE result_hash = NEW.result_hash
        AND publication_id = mirrored_publication_id
        AND expires_at = NEW.expires_at
    ) THEN
      RAISE EXCEPTION 'legacy scientific result conflicts with active mapping';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compute_scientific_results_generation_bridge
  ON compute_scientific_results;
CREATE TRIGGER compute_scientific_results_generation_bridge
AFTER INSERT ON compute_scientific_results
FOR EACH ROW EXECUTE FUNCTION mirror_compute_scientific_result_generation_one();

-- Backfill every 0001 row as generation 1. The legacy table and its immutable
-- trigger remain untouched, so migration adds a queryable generation history
-- without rewriting or deleting any already-published evidence.
INSERT INTO compute_scientific_result_publications (
  result_hash, generation, dataset_hash, spec_hash, build_id, task_id,
  object_key, object_sha256, object_byte_length, published_at, expires_at,
  publication_receipt
)
SELECT
  result_hash, 1, dataset_hash, spec_hash, build_id, task_id,
  object_key, object_sha256, object_byte_length, published_at, expires_at,
  publication_receipt
FROM compute_scientific_results
ON CONFLICT (result_hash, generation) DO NOTHING;

-- Only still-live legacy publications become active. Already-expired 0001
-- rows remain immutable history and can immediately be followed by generation
-- 2 when that result hash is published again.
INSERT INTO compute_scientific_result_active (
  result_hash, publication_id, expires_at
)
SELECT publication.result_hash, publication.publication_id, publication.expires_at
FROM compute_scientific_result_publications AS publication
WHERE publication.generation = 1
  AND publication.expires_at > clock_timestamp()
ON CONFLICT (result_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION reject_compute_scientific_publication_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compute scientific publication history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS compute_scientific_result_publications_immutable
  ON compute_scientific_result_publications;
CREATE TRIGGER compute_scientific_result_publications_immutable
BEFORE UPDATE OR DELETE ON compute_scientific_result_publications
FOR EACH ROW EXECUTE FUNCTION reject_compute_scientific_publication_history_mutation();

COMMIT;
