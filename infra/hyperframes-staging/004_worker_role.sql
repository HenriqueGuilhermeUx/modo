-- Run only AFTER 001, 002 and 003, and ONLY in the isolated staging DB.
-- This file NEVER creates a LOGIN nor supplies a password. A staging DB
-- operator must independently provision/rotate login credentials in a
-- secret manager and explicitly grant this no-login role.
DO $guard$
BEGIN
  IF current_database() <> 'modo_hyperframes_staging' THEN
    RAISE EXCEPTION 'HYPERFRAMES_WORKER_ROLE_WRONG_DATABASE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'hf_staging_worker'
  ) THEN
    CREATE ROLE hf_staging_worker NOLOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$guard$;

GRANT CONNECT ON DATABASE modo_hyperframes_staging TO hf_staging_worker;
GRANT USAGE ON SCHEMA modo_hyperframes_staging TO hf_staging_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE modo_hyperframes_staging.render_jobs,
           modo_hyperframes_staging.render_snapshots,
           modo_hyperframes_staging.render_artifacts
  TO hf_staging_worker;

-- Strictly avoid privileges for schema migrations, TRUNCATE and executable
-- functions, and keep role logins disabled until credentials are provisioned.
REVOKE ALL ON SCHEMA public FROM hf_staging_worker;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_worker;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE modo_hyperframes_staging.render_jobs,
           modo_hyperframes_staging.render_snapshots,
           modo_hyperframes_staging.render_artifacts
  FROM hf_staging_worker;
