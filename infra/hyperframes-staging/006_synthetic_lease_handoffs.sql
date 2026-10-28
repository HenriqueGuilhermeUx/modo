-- Contract v2 (synthetic isolated staging only). Manual CI-only migration.
DO $guard$
BEGIN
 IF current_database() <> 'modo_hyperframes_staging' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_WRONG_DATABASE';
 END IF;
 IF to_regclass('modo_hyperframes_staging.render_jobs') IS NULL THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_MISSING_QUEUE';
 END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_lease_handoffs (
 nonce UUID PRIMARY KEY,
 job_id UUID NOT NULL,
 organization_id TEXT NOT NULL CHECK (organization_id ~ '^synthetic-[a-z0-9-]{8,70}$'),
 worker_id TEXT NOT NULL CHECK (worker_id ~ '^[a-z][a-z0-9-]{3,50}$'),
 lease_fence UUID NOT NULL,
 lease_version INTEGER NOT NULL CHECK (lease_version > 0),
 attempts SMALLINT NOT NULL CHECK (attempts BETWEEN 1 AND 3),
 request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
 signed_order_sha256 CHAR(64) NOT NULL CHECK (signed_order_sha256 ~ '^[0-9a-f]{64}$'),
 claimed_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL,
 CONSTRAINT hf_synthetic_lease_expiry CHECK
   (expires_ms > claimed_ms AND expires_ms-claimed_ms <= 60000),
 CONSTRAINT hf_synthetic_lease_job_org_fk FOREIGN KEY (job_id,organization_id)
   REFERENCES modo_hyperframes_staging.render_jobs(job_id,organization_id)
   ON DELETE RESTRICT,
 CONSTRAINT hf_synthetic_one_dispatch_per_fence UNIQUE (job_id,lease_fence)
);
CREATE INDEX IF NOT EXISTS hf_synthetic_lease_lookup
 ON modo_hyperframes_staging.synthetic_lease_handoffs(job_id,organization_id);
REVOKE ALL ON modo_hyperframes_staging.synthetic_lease_handoffs FROM PUBLIC;
-- Reuse the NOLOGIN dispatcher from 005; it cannot log in or migrate schema.
DO $role$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'
    AND rolcanlogin=false) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_DISPATCHER_MISSING';
 END IF;
END
$role$;
GRANT INSERT ON modo_hyperframes_staging.synthetic_lease_handoffs
 TO hf_staging_nonce_dispatcher;
-- Only the columns required for a signed-lease predicate; no writes to queue.
GRANT SELECT (job_id,organization_id,project_id,request_sha256,version,
              status,attempts,lease_expires_ms,document)
 ON modo_hyperframes_staging.render_jobs TO hf_staging_nonce_dispatcher;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
 ON modo_hyperframes_staging.synthetic_lease_handoffs FROM hf_staging_nonce_dispatcher;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_nonce_dispatcher;
