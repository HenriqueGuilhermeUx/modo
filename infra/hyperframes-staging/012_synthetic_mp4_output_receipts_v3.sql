-- 012: synthetic-only V3 signed-output receipt ledger for renewed leases.
-- This is a PROOF RECORD, not final video storage. 010 old-v2 barrier remains.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  to_regclass('modo_hyperframes_staging.synthetic_lease_renewal_epochs') IS NULL OR
  to_regprocedure('modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(uuid,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_OUTPUT_WRONG_DATABASE_OR_MIGRATIONS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles
  WHERE rolname='hf_staging_lease_claim_owner' AND NOT rolcanlogin AND NOT rolsuper)
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_OUTPUT_OWNER_INVALID'; END IF;
END
$guard$;

CREATE TABLE modo_hyperframes_staging.synthetic_mp4_output_receipts_v3 (
 job_id UUID PRIMARY KEY,
 organization_id TEXT NOT NULL CHECK(organization_id='synthetic-tenant-mp4-receipt'),
 lease_fence UUID NOT NULL,
 receipt_sha256 CHAR(64) NOT NULL UNIQUE CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 continuation_sha256 CHAR(64) NOT NULL CHECK(continuation_sha256 ~ '^[0-9a-f]{64}$'),
 dispatch_sha256 CHAR(64) NOT NULL CHECK(dispatch_sha256 ~ '^[0-9a-f]{64}$'),
 admission_sha256 CHAR(64) NOT NULL CHECK(admission_sha256 ~ '^[0-9a-f]{64}$'),
 epoch SMALLINT NOT NULL CHECK(epoch IN (1,2)),
 lease_version INTEGER NOT NULL CHECK(lease_version>=2),
 output_sha256 CHAR(64) NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes INTEGER NOT NULL CHECK(output_bytes BETWEEN 4000 AND 25000000),
 committed_ms BIGINT NOT NULL,
 CONSTRAINT hf_output_v3_job_tenant_fk FOREIGN KEY(job_id,organization_id)
   REFERENCES modo_hyperframes_staging.render_jobs(job_id,organization_id)
   ON DELETE RESTRICT,
 CONSTRAINT hf_output_v3_job_fence_fk FOREIGN KEY(job_id,lease_fence)
   REFERENCES modo_hyperframes_staging.synthetic_lease_handoffs(job_id,lease_fence)
   ON DELETE RESTRICT
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_mp4_output_receipts_v3
 FROM PUBLIC,hf_staging_worker,hf_staging_nonce_dispatcher;
GRANT INSERT ON modo_hyperframes_staging.synthetic_mp4_output_receipts_v3
 TO hf_staging_lease_claim_owner;
GRANT SELECT(job_id,lease_fence)
 ON modo_hyperframes_staging.synthetic_mp4_output_receipts_v3
 TO hf_staging_lease_claim_owner;

GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE OR REPLACE FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_output_v3(
 p_job UUID,p_tenant TEXT,p_project TEXT,p_worker TEXT,p_fence UUID,
 p_version INTEGER,p_attempts SMALLINT,p_request_sha TEXT,
 p_dispatch_sha TEXT,p_admission_sha TEXT,p_epoch SMALLINT,
 p_continuation_sha TEXT,p_receipt_sha TEXT,p_output_sha TEXT,p_bytes INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $commit$
DECLARE
 v_job RECORD;
 v_dispatch RECORD;
 v_launch RECORD;
 v_latest RECORD;
 v_count INTEGER;
 v_now BIGINT;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  p_tenant IS DISTINCT FROM 'synthetic-tenant-mp4-receipt' OR
  p_job IS NULL OR p_fence IS NULL OR
  p_worker !~ '^[a-z][a-z0-9-]{3,50}$' OR
  p_request_sha !~ '^[0-9a-f]{64}$' OR
  p_dispatch_sha !~ '^[0-9a-f]{64}$' OR
  p_admission_sha !~ '^[0-9a-f]{64}$' OR
  p_continuation_sha !~ '^[0-9a-f]{64}$' OR
  p_receipt_sha !~ '^[0-9a-f]{64}$' OR
  p_output_sha !~ '^[0-9a-f]{64}$' OR
  p_version IS NULL OR p_version<2 OR
  p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 3 OR
  p_epoch IS NULL OR p_epoch NOT IN (1,2) OR
  p_bytes IS NULL OR p_bytes NOT BETWEEN 4000 AND 25000000
 THEN RETURN false; END IF;

 -- We lock the actual job row; a competing renewal/finish/fail cannot commit
 -- until this transaction completes. Read the DB clock AFTER locking.
 SELECT j.version,j.attempts,j.lease_expires_ms,j.document
 INTO v_job
 FROM modo_hyperframes_staging.render_jobs j
 WHERE j.job_id=p_job AND j.organization_id=p_tenant
  AND j.project_id=p_project AND j.request_sha256=p_request_sha
  AND j.status='running' AND j.version=p_version AND j.attempts=p_attempts
  AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND j.document->'lease'->>'fence'=p_fence::text
  AND j.document->'lease'->>'workerId'=p_worker
 FOR SHARE OF j;
 IF NOT FOUND THEN RETURN false; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_job.lease_expires_ms IS NULL OR v_job.lease_expires_ms<=v_now OR
  (v_job.document->>'version')::INTEGER<>v_job.version OR
  (v_job.document->'lease'->>'expiresAt')::BIGINT<>v_job.lease_expires_ms
 THEN RETURN false; END IF;

 SELECT h.lease_version INTO v_dispatch
 FROM modo_hyperframes_staging.synthetic_lease_handoffs h
 WHERE h.job_id=p_job AND h.organization_id=p_tenant AND h.lease_fence=p_fence
  AND h.worker_id=p_worker AND h.attempts=p_attempts
  AND h.request_sha256=p_request_sha AND h.signed_order_sha256=p_dispatch_sha;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT b.launched_ms INTO v_launch
 FROM modo_hyperframes_staging.synthetic_browser_launches b
 WHERE b.job_id=p_job AND b.organization_id=p_tenant AND b.lease_fence=p_fence
  AND b.dispatch_sha256=p_dispatch_sha AND b.admission_sha256=p_admission_sha;
 IF NOT FOUND OR v_launch.launched_ms IS NULL OR
  v_job.lease_expires_ms>v_launch.launched_ms+120000 OR
  v_now>v_launch.launched_ms+120000 THEN RETURN false; END IF;

 SELECT count(*)::integer INTO v_count
 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs e
 WHERE e.job_id=p_job AND e.organization_id=p_tenant AND e.lease_fence=p_fence
  AND e.dispatch_sha256=p_dispatch_sha AND e.admission_sha256=p_admission_sha
  AND e.attempts=p_attempts;
 IF v_count<>p_epoch OR p_version<>v_dispatch.lease_version+p_epoch THEN
  RETURN false; END IF;
 SELECT e.from_version,e.to_version,e.expires_ms INTO v_latest
 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs e
 WHERE e.job_id=p_job AND e.organization_id=p_tenant AND e.lease_fence=p_fence
 ORDER BY e.to_version DESC LIMIT 1;
 IF NOT FOUND OR v_latest.to_version<>p_version OR
  v_latest.expires_ms<>v_job.lease_expires_ms THEN RETURN false; END IF;

 -- Strictly one distinct v3 output receipt per lease fence. v2 records and
 -- encrypted finalization cannot coexist with this proof-only path.
 IF EXISTS(SELECT 1 FROM modo_hyperframes_staging.synthetic_receipt_attestations a
  WHERE a.job_id=p_job AND a.lease_fence=p_fence) OR
  EXISTS(SELECT 1 FROM modo_hyperframes_staging.synthetic_encrypted_finalizations f
  WHERE f.job_id=p_job AND f.lease_fence=p_fence)
 THEN RETURN false; END IF;

 INSERT INTO modo_hyperframes_staging.synthetic_mp4_output_receipts_v3(
  job_id,organization_id,lease_fence,receipt_sha256,continuation_sha256,
  dispatch_sha256,admission_sha256,epoch,lease_version,
  output_sha256,output_bytes,committed_ms)
 VALUES(p_job,p_tenant,p_fence,p_receipt_sha,p_continuation_sha,
  p_dispatch_sha,p_admission_sha,p_epoch,p_version,p_output_sha,p_bytes,v_now)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END
$commit$;
ALTER FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_output_v3(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,SMALLINT,
 TEXT,TEXT,TEXT,INTEGER) OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_output_v3(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,SMALLINT,
 TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,hf_staging_worker;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.commit_synthetic_mp4_output_v3(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,SMALLINT,
 TEXT,TEXT,TEXT,INTEGER) TO hf_staging_nonce_dispatcher;
-- A V3 output receipt seals the renewed lease epoch. A later heartbeat
-- cannot make already attested output stale or use the same launch twice.
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE FUNCTION modo_hyperframes_staging.seal_renewal_after_output_v3()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $seal$
BEGIN
 IF TG_OP<>'INSERT' OR current_database()<>'modo_hyperframes_staging' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_V3_SEAL_DISABLED';
 END IF;
 IF EXISTS (
  SELECT 1 FROM modo_hyperframes_staging.synthetic_mp4_output_receipts_v3 o
  WHERE o.job_id=NEW.job_id AND o.lease_fence=NEW.lease_fence
 ) THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_OUTPUT_ALREADY_ATTESTED'; END IF;
 RETURN NEW;
END
$seal$;
ALTER FUNCTION modo_hyperframes_staging.seal_renewal_after_output_v3()
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.seal_renewal_after_output_v3()
 FROM PUBLIC,hf_staging_worker,hf_staging_nonce_dispatcher;
CREATE TRIGGER hf_synthetic_seal_renewal_after_v3
 BEFORE INSERT ON modo_hyperframes_staging.synthetic_lease_renewal_epochs
 FOR EACH ROW EXECUTE FUNCTION
 modo_hyperframes_staging.seal_renewal_after_output_v3();
COMMIT;
