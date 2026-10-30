-- MODO HyperFrames: ONLY for a separate, disposable staging PostgreSQL DB.
-- Required database name: modo_hyperframes_staging (never run on customer DB).
-- No production workflow, service or application automatically executes this.
DO $guard$
BEGIN
  IF current_database() <> 'modo_hyperframes_staging' THEN
    RAISE EXCEPTION 'HYPERFRAMES_STAGING_WRONG_DATABASE';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS modo_hyperframes_staging;
REVOKE ALL ON SCHEMA modo_hyperframes_staging FROM PUBLIC;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.render_jobs (
  job_id UUID PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts SMALLINT NOT NULL DEFAULT 0,
  lease_expires_ms BIGINT,
  document JSONB NOT NULL,
  created_ms BIGINT NOT NULL,
  updated_ms BIGINT NOT NULL,
  CONSTRAINT hyperframes_unique_tenant_request
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT hyperframes_valid_sha
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hyperframes_valid_status
    CHECK (status IN ('queued','running','succeeded','failed')),
  CONSTRAINT hyperframes_valid_attempts
    CHECK (attempts >= 0 AND attempts <= 3),
  CONSTRAINT hyperframes_valid_version
    CHECK (version >= 0),
  CONSTRAINT hyperframes_record_identity
    CHECK (document->>'jobId' = job_id::text
       AND document->>'organizationId' = organization_id
       AND document->>'projectId' = project_id
       AND document->>'idempotencyKey' = idempotency_key
       AND document->>'requestSha256' = btrim(request_sha256)),
  CONSTRAINT hyperframes_record_version
    CHECK ((document->>'version')::integer = version),
  CONSTRAINT hyperframes_record_state
    CHECK (document->>'status' = status
       AND (document->>'attempts')::integer = attempts),
  CONSTRAINT hyperframes_no_publication
    CHECK (document->>'previewOnly' = 'true'
       AND document->>'published' = 'false')
);
CREATE INDEX IF NOT EXISTS hyperframes_claim_candidates
  ON modo_hyperframes_staging.render_jobs (status, lease_expires_ms, created_ms)
  WHERE status IN ('queued','running');
REVOKE ALL ON TABLE modo_hyperframes_staging.render_jobs FROM PUBLIC;
