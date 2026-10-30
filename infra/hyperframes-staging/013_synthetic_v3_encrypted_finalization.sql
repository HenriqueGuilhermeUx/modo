-- HyperFrames 013: separate strictly opt-in V3 AES-GCM FINALIZATION guard.
-- Disposable synthetic PostgreSQL database ONLY. The commercial renderer,
-- 008/009 V2 logic and 010 V2 post-renewal receipt rejection are preserved.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
    to_regclass('modo_hyperframes_staging.synthetic_mp4_output_receipts_v3') IS NULL OR
    to_regclass('modo_hyperframes_staging.synthetic_encrypted_finalizations') IS NULL OR
    to_regclass('modo_hyperframes_staging.render_artifacts') IS NULL
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_ENCRYPTED_WRONG_DATABASE_OR_SCHEMA'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner'
  AND rolcanlogin=false AND rolsuper=false) THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_V3_ENCRYPTED_OWNER_INVALID'; END IF;
END
$guard$;

ALTER TABLE modo_hyperframes_staging.render_artifacts
 ADD COLUMN v3_receipt_sha256 CHAR(64) NULL;
ALTER TABLE modo_hyperframes_staging.render_artifacts
 ADD CONSTRAINT hf_v3_optin_receipt_sha CHECK(
  v3_receipt_sha256 IS NULL OR v3_receipt_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE modo_hyperframes_staging.render_artifacts
 ADD CONSTRAINT hf_v3_receipt_fk FOREIGN KEY(v3_receipt_sha256)
 REFERENCES modo_hyperframes_staging.synthetic_mp4_output_receipts_v3(receipt_sha256)
 ON DELETE RESTRICT;

CREATE TABLE modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3(
 job_id UUID PRIMARY KEY,
 organization_id TEXT NOT NULL CHECK(organization_id='synthetic-tenant-mp4-receipt'),
 receipt_sha256 CHAR(64) NOT NULL UNIQUE
 REFERENCES modo_hyperframes_staging.synthetic_mp4_output_receipts_v3(receipt_sha256)
 ON DELETE RESTRICT,
 lease_fence UUID NOT NULL,
 lease_version INTEGER NOT NULL,
 epoch SMALLINT NOT NULL CHECK(epoch IN(1,2)),
 storage_key UUID NOT NULL UNIQUE,
 output_sha256 CHAR(64) NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes INTEGER NOT NULL CHECK(output_bytes BETWEEN 4000 AND 25000000),
 finalized_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL CHECK(expires_ms>finalized_ms)
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3
 FROM PUBLIC,hf_staging_nonce_dispatcher,hf_staging_worker;
GRANT INSERT ON modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3
 TO hf_staging_lease_claim_owner;
GRANT SELECT(receipt_sha256,job_id,organization_id,lease_fence,epoch,lease_version,
 output_sha256,output_bytes,committed_ms,dispatch_sha256,admission_sha256)
 ON modo_hyperframes_staging.synthetic_mp4_output_receipts_v3
 TO hf_staging_lease_claim_owner;

GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE FUNCTION modo_hyperframes_staging.assert_synthetic_v3_encrypted_artifact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $v3$
DECLARE
 v_receipt RECORD;
 v_now BIGINT;
 v_count INTEGER;
 v_max_version INTEGER;
 v_max_expiry BIGINT;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  TG_OP<>'INSERT' OR TG_WHEN NOT IN ('BEFORE','AFTER') OR
  NEW.organization_id<>'synthetic-tenant-mp4-receipt' OR
  NEW.v3_receipt_sha256 IS NULL
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_ENCRYPTED_DISABLED'; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 SELECT o.receipt_sha256,o.lease_fence,o.lease_version,o.epoch,
  o.output_sha256,o.output_bytes,o.committed_ms,
  j.lease_expires_ms,b.launched_ms
 INTO v_receipt
 FROM modo_hyperframes_staging.synthetic_mp4_output_receipts_v3 o
 JOIN modo_hyperframes_staging.render_jobs j
  ON j.job_id=o.job_id AND j.organization_id=o.organization_id
 JOIN modo_hyperframes_staging.synthetic_lease_handoffs h
  ON h.job_id=o.job_id AND h.organization_id=o.organization_id
   AND h.lease_fence=o.lease_fence
   AND h.signed_order_sha256=o.dispatch_sha256
 JOIN modo_hyperframes_staging.synthetic_browser_launches b
  ON b.job_id=o.job_id AND b.organization_id=o.organization_id
   AND b.lease_fence=o.lease_fence
   AND b.dispatch_sha256=o.dispatch_sha256
   AND b.admission_sha256=o.admission_sha256
 WHERE o.job_id=NEW.job_id AND o.organization_id=NEW.organization_id
  AND o.receipt_sha256=NEW.v3_receipt_sha256
  AND o.output_sha256=NEW.sha256 AND o.output_bytes=NEW.byte_length
  AND o.committed_ms<=v_now
  AND j.status='running' AND j.version=o.lease_version
  AND j.attempts=h.attempts AND j.request_sha256=h.request_sha256
  AND j.project_id=j.document->>'projectId'
  AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND (j.document->>'version')::INTEGER=j.version
  AND j.document->'lease'->>'fence'=o.lease_fence::text
  AND j.document->'lease'->>'workerId'=h.worker_id
  AND (j.document->'lease'->>'expiresAt')::BIGINT=j.lease_expires_ms
  AND j.lease_expires_ms>v_now
  AND j.lease_expires_ms<=b.launched_ms+120000
  AND v_now<=b.launched_ms+120000
  AND o.lease_version=h.lease_version+o.epoch
  AND NOT EXISTS(SELECT 1 FROM modo_hyperframes_staging.synthetic_receipt_attestations a
   WHERE a.job_id=o.job_id AND a.lease_fence=o.lease_fence);
 IF NOT FOUND THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_ENCRYPTED_PROOF_MISMATCH'; END IF;
 SELECT count(*)::INTEGER,max(e.to_version),max(e.expires_ms)
 INTO v_count,v_max_version,v_max_expiry
 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs e
 WHERE e.job_id=NEW.job_id AND e.organization_id=NEW.organization_id
  AND e.lease_fence=v_receipt.lease_fence;
 IF v_count<>v_receipt.epoch OR v_max_version<>v_receipt.lease_version OR
    v_max_expiry<>v_receipt.lease_expires_ms THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_V3_ENCRYPTED_STALE_EPOCH';
 END IF;
 -- 008/009 legacy V2 triggers are still mandatory for NON-opted-in artifacts.
 -- Opted-in artifacts cannot be finalized unless this *exact* signed V3
 -- receipt has been acknowledged and the renewed fence is still live.
 IF TG_WHEN='AFTER' THEN
  INSERT INTO modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3(
   job_id,organization_id,receipt_sha256,lease_fence,lease_version,epoch,
   storage_key,output_sha256,output_bytes,finalized_ms,expires_ms)
  VALUES(NEW.job_id,NEW.organization_id,v_receipt.receipt_sha256,
   v_receipt.lease_fence,v_receipt.lease_version,v_receipt.epoch,
   NEW.storage_key,NEW.sha256,NEW.byte_length,v_now,NEW.expires_ms);
 END IF;
 RETURN NEW;
END
$v3$;
ALTER FUNCTION modo_hyperframes_staging.assert_synthetic_v3_encrypted_artifact()
 OWNER TO hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.assert_synthetic_v3_encrypted_artifact()
 FROM PUBLIC,hf_staging_worker,hf_staging_nonce_dispatcher;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;

-- STRICT DISJOINT routes: null marker => unchanged V2 authorization;
-- nonnull marker => explicit V3 receipt/epoch/launch authorization.
DROP TRIGGER hf_synthetic_launch_artifact_barrier
 ON modo_hyperframes_staging.render_artifacts;
CREATE TRIGGER hf_synthetic_launch_artifact_barrier
 BEFORE INSERT ON modo_hyperframes_staging.render_artifacts
 FOR EACH ROW WHEN (NEW.v3_receipt_sha256 IS NULL)
 EXECUTE FUNCTION modo_hyperframes_staging.require_synthetic_browser_launch();
DROP TRIGGER hf_synthetic_encrypted_artifact_receipt
 ON modo_hyperframes_staging.render_artifacts;
CREATE TRIGGER hf_synthetic_encrypted_artifact_receipt
 AFTER INSERT ON modo_hyperframes_staging.render_artifacts
 FOR EACH ROW WHEN (NEW.v3_receipt_sha256 IS NULL)
 EXECUTE FUNCTION modo_hyperframes_staging.assert_synthetic_encrypted_finalization();
CREATE TRIGGER hf_synthetic_v3_encrypted_before
 BEFORE INSERT ON modo_hyperframes_staging.render_artifacts
 FOR EACH ROW WHEN (NEW.v3_receipt_sha256 IS NOT NULL)
 EXECUTE FUNCTION modo_hyperframes_staging.assert_synthetic_v3_encrypted_artifact();
CREATE TRIGGER hf_synthetic_v3_encrypted_after
 AFTER INSERT ON modo_hyperframes_staging.render_artifacts
 FOR EACH ROW WHEN (NEW.v3_receipt_sha256 IS NOT NULL)
 EXECUTE FUNCTION modo_hyperframes_staging.assert_synthetic_v3_encrypted_artifact();
COMMIT;
