-- HyperFrames only: manual migration in a disposable isolated staging DB.
DO $guard$
BEGIN
  IF current_database() <> 'modo_hyperframes_staging' THEN
    RAISE EXCEPTION 'HYPERFRAMES_SNAPSHOT_WRONG_DATABASE';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.render_snapshots (
  job_id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  byte_length INTEGER NOT NULL,
  created_ms BIGINT NOT NULL,
  expires_ms BIGINT NOT NULL,
  CONSTRAINT hyperframes_snapshots_job_tenant
    FOREIGN KEY (job_id, organization_id)
    REFERENCES modo_hyperframes_staging.render_jobs (job_id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT hyperframes_snapshots_sha
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hyperframes_snapshots_envelope
    CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16
      AND byte_length BETWEEN 1 AND 150000
      AND octet_length(ciphertext) = byte_length),
  CONSTRAINT hyperframes_snapshots_expiry
    CHECK (expires_ms > created_ms
      AND expires_ms - created_ms <= 3600000)
);
CREATE INDEX IF NOT EXISTS hyperframes_snapshots_expiration
  ON modo_hyperframes_staging.render_snapshots (expires_ms);
REVOKE ALL ON TABLE modo_hyperframes_staging.render_snapshots FROM PUBLIC;
