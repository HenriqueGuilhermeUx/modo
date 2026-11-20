-- HyperFrames synthetic receipt acknowledgement only. NO artifact publication.
-- Disposable staging database. Run after 001-006; never apply to customers.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'modo_hyperframes_staging' OR
  to_regclass('modo_hyperframes_staging.synthetic_lease_handoffs') IS NULL THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_RECEIPT_WRONG_DATABASE_OR_MISSING_LEASES';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner'
  AND NOT rolcanlogin AND NOT rolsuper) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_RECEIPT_OWNER_INVALID';
 END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_receipt_attestations (
 receipt_sha256 CHAR(64) PRIMARY KEY CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 job_id UUID NOT NULL,
 organization_id TEXT NOT NULL CHECK(organization_id ~ '^synthetic-[a-z0-9-]{8,70}$'),
 lease_fence UUID NOT NULL,
 output_sha256 CHAR(64) NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes INTEGER NOT NULL CHECK(output_bytes BETWEEN 4000 AND 25000000),
 committed_ms BIGINT NOT NULL,
 CONSTRAINT hf_one_receipt_per_fence UNIQUE(job_id,lease_fence),
 CONSTRAINT hf_receipt_matches_dispensed_lease FOREIGN KEY(job_id,lease_fence)
  REFERENCES modo_hyperframes_staging.synthetic_lease_handoffs(job_id,lease_fence)
  ON DELETE RESTRICT,
 CONSTRAINT hf_receipt_matches_tenant_job FOREIGN KEY(job_id,organization_id)
  REFERENCES modo_hyperframes_staging.render_jobs(job_id,organization_id)
  ON DELETE RESTRICT
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_receipt_attestations FROM PUBLIC;
GRANT INSERT ON modo_hyperframes_staging.synthetic_receipt_attestations
 TO hf_staging_lease_claim_owner;
GRANT SELECT (job_id,organization_id,lease_fence,signed_order_sha256)
 ON modo_hyperframes_staging.synthetic_lease_handoffs TO hf_staging_lease_claim_owner;
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE OR REPLACE FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_receipt(
 p_job uuid,p_tenant text,p_project text,p_worker text,p_fence uuid,
 p_version integer,p_attempts smallint,p_request_sha text,p_dispatch_sha text,
 p_receipt_sha text,p_output_sha text,p_bytes integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,modo_hyperframes_staging
AS $receipt$
DECLARE
 v_lease_exp bigint;
 v_now bigint;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  p_tenant !~ '^synthetic-[a-z0-9-]{8,70}$' OR
  p_worker !~ '^[a-z][a-z0-9-]{3,50}$' OR
  p_request_sha !~ '^[0-9a-f]{64}$' OR
  p_dispatch_sha !~ '^[0-9a-f]{64}$' OR
  p_receipt_sha !~ '^[0-9a-f]{64}$' OR
  p_output_sha !~ '^[0-9a-f]{64}$' OR
  p_version IS NULL OR p_version < 1 OR
  p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 3 OR
  p_bytes IS NULL OR p_bytes NOT BETWEEN 4000 AND 25000000 THEN
  RETURN false;
 END IF;
 -- Serialize against queue. The database clock is read AFTER row-locking.
 SELECT j.lease_expires_ms INTO v_lease_exp
 FROM modo_hyperframes_staging.render_jobs j
 WHERE j.job_id=p_job AND j.organization_id=p_tenant
  AND j.project_id=p_project AND j.request_sha256=p_request_sha
  AND j.status='running' AND j.version=p_version AND j.attempts=p_attempts
  AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND j.document->'lease'->>'workerId'=p_worker
  AND j.document->'lease'->>'fence'=p_fence::text
 FOR SHARE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_lease_exp IS NULL OR v_lease_exp<=v_now THEN RETURN false; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM modo_hyperframes_staging.synthetic_lease_handoffs h
  WHERE h.job_id=p_job AND h.organization_id=p_tenant
   AND h.lease_fence=p_fence AND h.signed_order_sha256=p_dispatch_sha
 ) THEN RETURN false; END IF;
 INSERT INTO modo_hyperframes_staging.synthetic_receipt_attestations(
  receipt_sha256,job_id,organization_id,lease_fence,output_sha256,
  output_bytes,committed_ms)
 VALUES(p_receipt_sha,p_job,p_tenant,p_fence,p_output_sha,p_bytes,v_now)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END
$receipt$;
ALTER FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_receipt(
 uuid,text,text,text,uuid,integer,smallint,text,text,text,text,integer)
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_receipt(
 uuid,text,text,text,uuid,integer,smallint,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_receipt(
 uuid,text,text,text,uuid,integer,smallint,text,text,text,text,integer)
 TO hf_staging_nonce_dispatcher;
REVOKE ALL ON modo_hyperframes_staging.synthetic_receipt_attestations
 FROM hf_staging_nonce_dispatcher,hf_staging_worker;
COMMIT;
