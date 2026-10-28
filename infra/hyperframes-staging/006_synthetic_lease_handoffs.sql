-- HyperFrames synthetic lease-bound dispatch. Disposable DB ONLY.
-- Trusted, least-privilege SECURITY DEFINER function avoids granting the
-- dispatcher UPDATE rights on render_jobs just to take FOR SHARE row locks.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'modo_hyperframes_staging' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_WRONG_DATABASE';
 END IF;
 IF to_regclass('modo_hyperframes_staging.render_jobs') IS NULL THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_MISSING_QUEUE';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles
   WHERE rolname='hf_staging_nonce_dispatcher' AND NOT rolcanlogin) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LEASE_DISPATCHER_MISSING';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner') THEN
  CREATE ROLE hf_staging_lease_claim_owner NOLOGIN
   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
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
REVOKE ALL ON modo_hyperframes_staging.synthetic_lease_handoffs
 FROM hf_staging_nonce_dispatcher;
-- Only the function owner may query/row-lock the queue and INSERT a claim.
GRANT CONNECT ON DATABASE modo_hyperframes_staging TO hf_staging_lease_claim_owner;
GRANT USAGE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
GRANT SELECT (job_id,organization_id,project_id,request_sha256,
 version,status,attempts,lease_expires_ms,document)
 ON modo_hyperframes_staging.render_jobs TO hf_staging_lease_claim_owner;
-- PostgreSQL row-lock requires UPDATE privilege. Only a NOLOGIN function
-- owner gets UPDATE on this single column; dispatcher gets NONE.
GRANT UPDATE (version) ON modo_hyperframes_staging.render_jobs
 TO hf_staging_lease_claim_owner;
GRANT INSERT ON modo_hyperframes_staging.synthetic_lease_handoffs
 TO hf_staging_lease_claim_owner;
-- Owners of schema functions need CREATE at ownership transfer time only.
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;

CREATE OR REPLACE FUNCTION modo_hyperframes_staging.consume_synthetic_lease(
 p_nonce uuid,p_job uuid,p_tenant text,p_project text,p_worker text,
 p_fence uuid,p_version integer,p_attempts smallint,
 p_request_sha text,p_signed_sha text,p_expires_ms bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, modo_hyperframes_staging
AS $function$
DECLARE
 v_lease_exp bigint;
 v_ms bigint;
BEGIN
 IF current_database() <> 'modo_hyperframes_staging' OR
  p_tenant !~ '^synthetic-[a-z0-9-]{8,70}$' OR
  p_worker !~ '^[a-z][a-z0-9-]{3,50}$' OR
  p_request_sha !~ '^[0-9a-f]{64}$' OR
  p_signed_sha !~ '^[0-9a-f]{64}$' OR
  p_version IS NULL OR p_version <= 0 OR
  p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 3 OR
  p_expires_ms IS NULL THEN
  RETURN false;
 END IF;
 -- Serialize with the actual queue state transition. The lock is held until
 -- the caller's statement/transaction ends and includes current lease fence.
 SELECT j.lease_expires_ms INTO v_lease_exp
 FROM modo_hyperframes_staging.render_jobs j
 WHERE j.job_id=p_job AND j.organization_id=p_tenant
  AND j.project_id=p_project AND j.request_sha256=p_request_sha
  AND j.status='running' AND j.version=p_version
  AND j.attempts=p_attempts
  AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND j.document->'lease'->>'workerId'=p_worker
  AND j.document->'lease'->>'fence'=p_fence::text
 FOR SHARE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Check wall clock AFTER acquiring the lock (not before waiting for it).
 v_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_lease_exp IS NULL OR v_lease_exp<=v_ms OR
  p_expires_ms<=v_ms OR p_expires_ms>v_ms+60000 THEN
  RETURN false;
 END IF;
 INSERT INTO modo_hyperframes_staging.synthetic_lease_handoffs(
  nonce,job_id,organization_id,worker_id,lease_fence,lease_version,
  attempts,request_sha256,signed_order_sha256,claimed_ms,expires_ms)
 VALUES(p_nonce,p_job,p_tenant,p_worker,p_fence,p_version,p_attempts,
  p_request_sha,p_signed_sha,v_ms,p_expires_ms)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END
$function$;
-- Privileged migrations may transfer ownership; no untrusted role has CREATE
-- or direct access to the queue row lock afterward.
ALTER FUNCTION modo_hyperframes_staging.consume_synthetic_lease(
 uuid,uuid,text,text,text,uuid,integer,smallint,text,text,bigint)
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.consume_synthetic_lease(
 uuid,uuid,text,text,text,uuid,integer,smallint,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.consume_synthetic_lease(
 uuid,uuid,text,text,text,uuid,integer,smallint,text,text,bigint) FROM hf_staging_worker;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.consume_synthetic_lease(
 uuid,uuid,text,text,text,uuid,integer,smallint,text,text,bigint)
 TO hf_staging_nonce_dispatcher;
-- Prevent accidental direct reads or mutations from dispatcher/legacy worker.
REVOKE ALL ON modo_hyperframes_staging.render_jobs FROM hf_staging_nonce_dispatcher;
REVOKE ALL ON modo_hyperframes_staging.synthetic_lease_handoffs
 FROM hf_staging_nonce_dispatcher;
COMMIT;
