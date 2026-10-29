-- 010: experimental, fail-closed synthetic-only lease renewal epochs.
-- Validated ONLY in disposable DB modo_hyperframes_staging, NEVER customers.
-- Does NOT authorize post-renewal MP4 receipts until separate signed v3 support.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  to_regclass('modo_hyperframes_staging.synthetic_browser_launches') IS NULL OR
  to_regclass('modo_hyperframes_staging.synthetic_receipt_attestations') IS NULL THEN
   RAISE EXCEPTION 'HF_SYNTHETIC_RENEWAL_WRONG_DATABASE_OR_SCHEMA';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles
   WHERE rolname='hf_staging_lease_claim_owner'
    AND rolcanlogin=false AND rolsuper=false) OR
  NOT EXISTS(SELECT 1 FROM pg_roles
   WHERE rolname='hf_staging_nonce_dispatcher'
    AND rolcanlogin=false AND rolsuper=false)
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_RENEWAL_ROLE_INVALID'; END IF;
END
$guard$;
CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_lease_renewal_epochs (
 job_id UUID NOT NULL,
 organization_id TEXT NOT NULL CHECK(organization_id='synthetic-tenant-mp4-receipt'),
 lease_fence UUID NOT NULL,
 from_version INTEGER NOT NULL CHECK(from_version>=1),
 to_version INTEGER NOT NULL CHECK(to_version=from_version+1),
 attempts SMALLINT NOT NULL CHECK(attempts BETWEEN 1 AND 3),
 dispatch_sha256 CHAR(64) NOT NULL CHECK(dispatch_sha256 ~ '^[0-9a-f]{64}$'),
 admission_sha256 CHAR(64) NOT NULL CHECK(admission_sha256 ~ '^[0-9a-f]{64}$'),
 renewed_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL CHECK(expires_ms>renewed_ms AND expires_ms-renewed_ms<=60000),
 CONSTRAINT hf_synthetic_renewal_step PRIMARY KEY(job_id,lease_fence,to_version),
 CONSTRAINT hf_synthetic_renewal_one_successor UNIQUE(job_id,lease_fence,from_version),
 CONSTRAINT hf_synthetic_renewal_claim_fk FOREIGN KEY(job_id,lease_fence)
   REFERENCES modo_hyperframes_staging.synthetic_lease_handoffs(job_id,lease_fence)
   ON DELETE RESTRICT,
 CONSTRAINT hf_synthetic_renewal_tenant_fk FOREIGN KEY(job_id,organization_id)
   REFERENCES modo_hyperframes_staging.render_jobs(job_id,organization_id)
   ON DELETE RESTRICT
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_lease_renewal_epochs
 FROM PUBLIC,hf_staging_worker,hf_staging_nonce_dispatcher;
GRANT INSERT ON modo_hyperframes_staging.synthetic_lease_renewal_epochs
 TO hf_staging_lease_claim_owner;
GRANT SELECT (job_id,lease_fence,from_version,to_version,expires_ms)
 ON modo_hyperframes_staging.synthetic_lease_renewal_epochs
 TO hf_staging_lease_claim_owner;
GRANT SELECT (job_id,lease_fence)
 ON modo_hyperframes_staging.synthetic_encrypted_finalizations
 TO hf_staging_lease_claim_owner;
-- The NOLOGIN owner alone may perform the atomic documented transition;
-- dispatcher retains EXECUTE-only, never UPDATE/SELECT on queue.
GRANT UPDATE (version,document,lease_expires_ms,updated_ms)
 ON modo_hyperframes_staging.render_jobs TO hf_staging_lease_claim_owner;
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;

CREATE OR REPLACE FUNCTION modo_hyperframes_staging.renew_synthetic_lease_epoch(
 p_job UUID,p_tenant TEXT,p_project TEXT,p_worker TEXT,p_fence UUID,
 p_version INTEGER,p_attempts SMALLINT,p_request_sha TEXT,
 p_dispatch_sha TEXT,p_admission_sha TEXT,p_duration_ms INTEGER
) RETURNS TABLE(renewed BOOLEAN,lease_version INTEGER,expires_ms BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $renew$
DECLARE
 v_doc JSONB;
 v_lease_exp BIGINT;
 v_dispatch_version INTEGER;
 v_launch_ms BIGINT;
 v_now BIGINT;
 v_next BIGINT;
 v_n INTEGER;
 v_last_exp BIGINT;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
   p_tenant<>'synthetic-tenant-mp4-receipt' OR
   p_worker !~ '^[a-z][a-z0-9-]{3,50}$' OR
   p_request_sha !~ '^[0-9a-f]{64}$' OR
   p_dispatch_sha !~ '^[0-9a-f]{64}$' OR
   p_admission_sha !~ '^[0-9a-f]{64}$' OR
   p_version IS NULL OR p_version<1 OR
   p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 3 OR
   p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 1000 AND 60000 THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 -- Exclusive lock serializes against all normal queue heartbeats, finishes,
 -- fails and competing epoch renewals. Clock is read AFTER acquiring lock.
 SELECT j.document,j.lease_expires_ms INTO v_doc,v_lease_exp
 FROM modo_hyperframes_staging.render_jobs j
 WHERE j.job_id=p_job AND j.organization_id=p_tenant
  AND j.project_id=p_project AND j.request_sha256=p_request_sha
  AND j.status='running' AND j.version=p_version
  AND j.attempts=p_attempts
  AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND j.document->'lease'->>'workerId'=p_worker
  AND j.document->'lease'->>'fence'=p_fence::text
 FOR UPDATE OF j;
 IF NOT FOUND THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_lease_exp IS NULL OR v_lease_exp<=v_now OR
  (v_doc->'lease'->>'expiresAt')::bigint<>v_lease_exp THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 SELECT h.lease_version INTO v_dispatch_version
 FROM modo_hyperframes_staging.synthetic_lease_handoffs h
 WHERE h.job_id=p_job AND h.organization_id=p_tenant
  AND h.lease_fence=p_fence AND h.worker_id=p_worker
  AND h.attempts=p_attempts AND h.request_sha256=p_request_sha
  AND h.signed_order_sha256=p_dispatch_sha;
 IF NOT FOUND THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 SELECT b.launched_ms INTO v_launch_ms
 FROM modo_hyperframes_staging.synthetic_browser_launches b
 WHERE b.job_id=p_job AND b.organization_id=p_tenant
  AND b.lease_fence=p_fence AND b.dispatch_sha256=p_dispatch_sha
  AND b.admission_sha256=p_admission_sha;
 IF NOT FOUND THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 -- No renewals after receipts or encrypted finalization have started.
 IF EXISTS (SELECT 1 FROM modo_hyperframes_staging.synthetic_receipt_attestations a
  WHERE a.job_id=p_job AND a.lease_fence=p_fence) OR
  EXISTS (SELECT 1 FROM modo_hyperframes_staging.synthetic_encrypted_finalizations e
  WHERE e.job_id=p_job AND e.lease_fence=p_fence) THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 SELECT count(*)::INTEGER,max(r.expires_ms) INTO v_n,v_last_exp
 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs r
 WHERE r.job_id=p_job AND r.lease_fence=p_fence;
 -- Max TWO renewals; forbid all version jumps or unrelated queue heartbeats.
 IF v_n>=2 OR p_version<>v_dispatch_version+v_n OR
  (v_n>0 AND v_last_exp IS DISTINCT FROM v_lease_exp) THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 v_next:=v_now+p_duration_ms;
 -- Total renewal horizon is at most 2 min from the one-shot browser launch,
 -- and every renewal must extend, never shorten, the prior lease.
 IF v_next<=v_lease_exp OR
   v_next>v_launch_ms+120000 THEN
  RETURN QUERY SELECT false,NULL::INTEGER,NULL::BIGINT; RETURN;
 END IF;
 UPDATE modo_hyperframes_staging.render_jobs j
 SET version=p_version+1,
  lease_expires_ms=v_next,updated_ms=v_now,
  document=jsonb_set(
   v_doc || jsonb_build_object('version',p_version+1,'updatedAt',v_now),
   '{lease,expiresAt}',to_jsonb(v_next),false)
 WHERE j.job_id=p_job AND j.organization_id=p_tenant AND j.version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'HF_SYNTHETIC_RENEWAL_CONCURRENT_UPDATE'; END IF;
 INSERT INTO modo_hyperframes_staging.synthetic_lease_renewal_epochs(
  job_id,organization_id,lease_fence,from_version,to_version,attempts,
  dispatch_sha256,admission_sha256,renewed_ms,expires_ms)
 VALUES(p_job,p_tenant,p_fence,p_version,p_version+1,p_attempts,
  p_dispatch_sha,p_admission_sha,v_now,v_next);
 RETURN QUERY SELECT true,p_version+1,v_next;
END
$renew$;
ALTER FUNCTION modo_hyperframes_staging.renew_synthetic_lease_epoch(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,INTEGER)
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.renew_synthetic_lease_epoch(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,INTEGER)
 FROM PUBLIC,hf_staging_worker;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.renew_synthetic_lease_epoch(
 UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,INTEGER)
 TO hf_staging_nonce_dispatcher;

-- Re-attested versioned receipt support is intentionally NOT enabled here.
-- A renewed lease cannot create an ordinary v2 receipt by reusing the old
-- dispatch; the subsequent version-aware receipt protocol must be reviewed.
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE OR REPLACE FUNCTION modo_hyperframes_staging.reject_receipt_after_lease_renewal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $block_receipt$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_RENEWAL_RECEIPT_DISABLED';
 END IF;
 IF NEW.organization_id='synthetic-tenant-mp4-receipt' AND EXISTS (
  SELECT 1 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs r
  WHERE r.job_id=NEW.job_id AND r.lease_fence=NEW.lease_fence
 ) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_RENEWAL_RECEIPT_V3_REQUIRED';
 END IF;
 RETURN NEW;
END
$block_receipt$;
ALTER FUNCTION modo_hyperframes_staging.reject_receipt_after_lease_renewal()
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.reject_receipt_after_lease_renewal()
 FROM PUBLIC,hf_staging_nonce_dispatcher,hf_staging_worker;
DROP TRIGGER IF EXISTS hf_synthetic_receipt_renewal_barrier
 ON modo_hyperframes_staging.synthetic_receipt_attestations;
CREATE TRIGGER hf_synthetic_receipt_renewal_barrier
 BEFORE INSERT ON modo_hyperframes_staging.synthetic_receipt_attestations
 FOR EACH ROW
 EXECUTE FUNCTION modo_hyperframes_staging.reject_receipt_after_lease_renewal();
COMMIT;
