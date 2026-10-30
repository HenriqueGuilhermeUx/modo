-- Disposable HyperFrames staging only; NEVER customer or production databases.
DO $guard$
BEGIN
 IF current_database() <> 'modo_hyperframes_staging' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_NONCE_WRONG_DATABASE';
 END IF;
END
$guard$;
CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_handoff_nonces (
 nonce UUID PRIMARY KEY,
 tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^synthetic-[a-z0-9-]{8,70}$'),
 job_id TEXT NOT NULL CHECK (job_id ~ '^synthetic-[a-z0-9-]{8,70}$'),
 worker_id TEXT NOT NULL CHECK (worker_id ~ '^[a-z][a-z0-9-]{3,50}$'),
 key_id TEXT NOT NULL CHECK (key_id ~ '^[a-z][a-z0-9-]{3,50}$'),
 order_sha256 CHAR(64) NOT NULL CHECK (order_sha256 ~ '^[0-9a-f]{64}$'),
 claimed_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL,
 CONSTRAINT hf_synthetic_nonce_ttl CHECK (expires_ms > claimed_ms AND expires_ms - claimed_ms <= 60000)
);
CREATE INDEX IF NOT EXISTS hf_synthetic_nonce_expiry
 ON modo_hyperframes_staging.synthetic_handoff_nonces (expires_ms);
REVOKE ALL ON modo_hyperframes_staging.synthetic_handoff_nonces FROM PUBLIC;
DO $role$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hf_staging_nonce_dispatcher') THEN
  CREATE ROLE hf_staging_nonce_dispatcher NOLOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
 END IF;
END
$role$;
GRANT CONNECT ON DATABASE modo_hyperframes_staging TO hf_staging_nonce_dispatcher;
GRANT USAGE ON SCHEMA modo_hyperframes_staging TO hf_staging_nonce_dispatcher;
GRANT INSERT ON modo_hyperframes_staging.synthetic_handoff_nonces TO hf_staging_nonce_dispatcher;
REVOKE SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
 ON modo_hyperframes_staging.synthetic_handoff_nonces FROM hf_staging_nonce_dispatcher;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_nonce_dispatcher;
