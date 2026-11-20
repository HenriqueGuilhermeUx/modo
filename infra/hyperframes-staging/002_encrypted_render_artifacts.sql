-- Isolated HyperFrames staging ONLY. Never execute against the MODO customer DB.
-- The video bytes are encrypted in the application before they enter Postgres.
-- This is intentionally a bounded, small-scale staging backend, not a CDN.
DO $guard$
BEGIN
  IF current_database() <> 'modo_hyperframes_staging' THEN
    RAISE EXCEPTION 'HYPERFRAMES_ARTIFACT_WRONG_DATABASE';
  END IF;
END
$guard$;

-- Prove that a stored object belongs to the same job AND organization.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hyperframes_job_org_unique'
      AND conrelid = 'modo_hyperframes_staging.render_jobs'::regclass
  ) THEN
    ALTER TABLE modo_hyperframes_staging.render_jobs
      ADD CONSTRAINT hyperframes_job_org_unique UNIQUE (job_id, organization_id);
  END IF;
END
$constraint$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.render_artifacts (
  job_id UUID NOT NULL,
  organization_id TEXT NOT NULL,
  storage_key UUID NOT NULL UNIQUE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  sha256 CHAR(64) NOT NULL,
  byte_length INTEGER NOT NULL,
  expires_ms BIGINT NOT NULL,
  created_ms BIGINT NOT NULL,
  CONSTRAINT hyperframes_artifact_job PRIMARY KEY (job_id),
  CONSTRAINT hyperframes_artifact_identity
    FOREIGN KEY (job_id, organization_id)
    REFERENCES modo_hyperframes_staging.render_jobs (job_id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT hyperframes_artifact_checksum
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hyperframes_artifact_bytes
    CHECK (byte_length BETWEEN 4000 AND 25000000
       AND octet_length(ciphertext) = byte_length),
  CONSTRAINT hyperframes_artifact_aes_gcm
    CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16),
  CONSTRAINT hyperframes_artifact_expiry
    CHECK (expires_ms > created_ms AND expires_ms - created_ms <= 900000)
);
CREATE INDEX IF NOT EXISTS hyperframes_artifacts_expiring
  ON modo_hyperframes_staging.render_artifacts (expires_ms);
REVOKE ALL ON TABLE modo_hyperframes_staging.render_artifacts FROM PUBLIC;
