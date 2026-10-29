-- 009: Disposable synthetic-only one-shot trusted launch barrier.
-- This is NOT a browser-accessible endpoint or a production authorization.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
    to_regclass('modo_hyperframes_staging.synthetic_lease_handoffs') IS NULL OR
    to_regclass('modo_hyperframes_staging.synthetic_encrypted_finalizations') IS NULL THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LAUNCH_WRONG_DATABASE_OR_SCHEMA';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner'
    AND rolcanlogin=false AND rolsuper=false) OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'
    AND rolcanlogin=false AND rolsuper=false) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LAUNCH_ROLE_INVALID';
 END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_browser_launches(
 nonce UUID PRIMARY KEY,
 job_id UUID NOT NULL,
 organization_id TEXT NOT NULL
  CHECK(organization_id='synthetic-tenant-mp4-receipt'),
 lease_fence UUID NOT NULL,
 admission_sha256 CHAR(64) NOT NULL UNIQUE
  CHECK(admission_sha256 ~ '^[0-9a-f]{64}$'),
 renderer_order_sha256 CHAR(64) NOT NULL
  CHECK(renderer_order_sha256 ~ '^[0-9a-f]{64}$'),
 dispatch_sha256 CHAR(64) NOT NULL
  CHECK(dispatch_sha256 ~ '^[0-9a-f]{64}$'),
 launched_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL
  CHECK(expires_ms>launched_ms AND expires_ms-launched_ms<=60000),
 CONSTRAINT hf_single_browser_launch_per_fence UNIQUE(job_id,lease_fence),
 CONSTRAINT hf_launch_matches_dispensed_lease FOREIGN KEY(job_id,lease_fence)
  REFERENCES modo_hyperframes_staging.synthetic_lease_handoffs(job_id,lease_fence)
  ON DELETE RESTRICT,
 CONSTRAINT hf_launch_matches_job_tenant FOREIGN KEY(job_id,organization_id)
  REFERENCES modo_hyperframes_staging.render_jobs(job_id,organization_id)
  ON DELETE RESTRICT
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_browser_launches FROM PUBLIC;
REVOKE ALL ON modo_hyperframes_staging.synthetic_browser_launches
 FROM hf_staging_nonce_dispatcher,hf_staging_worker;
GRANT INSERT ON modo_hyperframes_staging.synthetic_browser_launches
 TO hf_staging_lease_claim_owner;
GRANT SELECT (nonce,job_id,organization_id,lease_fence,admission_sha256,
 renderer_order_sha256,dispatch_sha256,launched_ms,expires_ms)
 ON modo_hyperframes_staging.synthetic_browser_launches
 TO hf_staging_lease_claim_owner;
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;

CREATE OR REPLACE FUNCTION modo_hyperframes_staging.consume_synthetic_browser_launch(
 p_nonce UUID,p_job UUID,p_tenant TEXT,p_project TEXT,p_worker TEXT,p_fence UUID,
 p_version INTEGER,p_attempts SMALLINT,p_request_sha TEXT,p_dispatch_sha TEXT,
 p_order_sha TEXT,p_admission_sha TEXT,p_expiry BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $launch$
DECLARE
 v_lease_exp BIGINT;
 v_now BIGINT;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  p_tenant<>'synthetic-tenant-mp4-receipt' OR
  p_worker !~ '^[a-z][a-z0-9-]{3,50}$' OR
  p_request_sha !~ '^[0-9a-f]{64}$' OR
  p_dispatch_sha !~ '^[0-9a-f]{64}$' OR
  p_order_sha !~ '^[0-9a-f]{64}$' OR
  p_admission_sha !~ '^[0-9a-f]{64}$' OR
  p_version IS NULL OR p_version<1 OR
  p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 3 OR
  p_expiry IS NULL THEN RETURN false; END IF;
 -- Lock the actual queue row first; validate clock AFTER possible wait.
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
 IF v_lease_exp IS NULL OR v_lease_exp<=v_now OR
    p_expiry<=v_now OR p_expiry>v_now+60000 OR
    p_expiry>v_lease_exp THEN RETURN false; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM modo_hyperframes_staging.synthetic_lease_handoffs h
  WHERE h.job_id=p_job AND h.organization_id=p_tenant
   AND h.lease_fence=p_fence AND h.lease_version=p_version
   AND h.attempts=p_attempts AND h.request_sha256=p_request_sha
   AND h.worker_id=p_worker AND h.signed_order_sha256=p_dispatch_sha
   AND h.expires_ms>=v_now
 ) THEN RETURN false; END IF;
 INSERT INTO modo_hyperframes_staging.synthetic_browser_launches(
  nonce,job_id,organization_id,lease_fence,admission_sha256,
  renderer_order_sha256,dispatch_sha256,launched_ms,expires_ms)
 VALUES(p_nonce,p_job,p_tenant,p_fence,p_admission_sha,
  p_order_sha,p_dispatch_sha,v_now,p_expiry)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END
$launch$;
ALTER FUNCTION modo_hyperframes_staging.consume_synthetic_browser_launch(
 UUID,UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,TEXT,BIGINT)
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.consume_synthetic_browser_launch(
 UUID,UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,TEXT,BIGINT)
 FROM PUBLIC,hf_staging_worker;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.consume_synthetic_browser_launch(
 UUID,UUID,TEXT,TEXT,TEXT,UUID,INTEGER,SMALLINT,TEXT,TEXT,TEXT,TEXT,BIGINT)
 TO hf_staging_nonce_dispatcher;

-- A finalization of this synthetic tenant without a one-shot trusted launch
-- is rejected; the existing encrypted vault transaction rolls back.
CREATE OR REPLACE FUNCTION modo_hyperframes_staging.require_synthetic_browser_launch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $guard_launch$
BEGIN
 IF TG_OP<>'INSERT' OR current_database()<>'modo_hyperframes_staging' THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LAUNCH_FINALIZATION_DISABLED';
 END IF;
 IF NEW.organization_id<>'synthetic-tenant-mp4-receipt' THEN RETURN NEW; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM modo_hyperframes_staging.synthetic_browser_launches b
  JOIN modo_hyperframes_staging.synthetic_receipt_attestations a
   ON a.job_id=b.job_id AND a.organization_id=b.organization_id
   AND a.lease_fence=b.lease_fence
   AND a.output_sha256=NEW.sha256 AND a.output_bytes=NEW.byte_length
  JOIN modo_hyperframes_staging.render_jobs j
   ON j.job_id=b.job_id AND j.organization_id=b.organization_id
  WHERE b.job_id=NEW.job_id AND b.organization_id=NEW.organization_id
    AND b.dispatch_sha256 IN (
      SELECT signed_order_sha256
      FROM modo_hyperframes_staging.synthetic_lease_handoffs h
      WHERE h.job_id=b.job_id AND h.lease_fence=b.lease_fence
    )
    AND j.document->'lease'->>'fence'=b.lease_fence::text
    AND j.status='running' AND j.lease_expires_ms>
     floor(extract(epoch FROM clock_timestamp())*1000)::bigint
 ) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_LAUNCH_FINALIZATION_NOT_CLAIMED';
 END IF;
 RETURN NEW;
END
$guard_launch$;
ALTER FUNCTION modo_hyperframes_staging.require_synthetic_browser_launch()
 OWNER TO hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.require_synthetic_browser_launch()
 FROM PUBLIC,hf_staging_nonce_dispatcher,hf_staging_worker;
DROP TRIGGER IF EXISTS hf_synthetic_launch_artifact_barrier
 ON modo_hyperframes_staging.render_artifacts;
CREATE TRIGGER hf_synthetic_launch_artifact_barrier
 BEFORE INSERT ON modo_hyperframes_staging.render_artifacts FOR EACH ROW
 EXECUTE FUNCTION modo_hyperframes_staging.require_synthetic_browser_launch();
COMMIT;
