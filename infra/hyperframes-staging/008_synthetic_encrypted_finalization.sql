-- Synthetic-only integration with the EXISTING AES-256-GCM artifact store.
-- Disposable modo_hyperframes_staging database; manual CI migration AFTER 001-007.
-- The trigger is limited to a SINGLE synthetic pilot tenant. It does NOT
-- change customer/prod tenants or the existing artifact storage implementation.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
   to_regclass('modo_hyperframes_staging.render_artifacts') IS NULL OR
   to_regclass('modo_hyperframes_staging.synthetic_receipt_attestations') IS NULL
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_ENCRYPTED_FINALIZATION_WRONG_DATABASE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner'
   AND rolcanlogin=false AND rolsuper=false)
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_ENCRYPTED_FINALIZATION_INVALID_OWNER'; END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS modo_hyperframes_staging.synthetic_encrypted_finalizations (
 job_id UUID PRIMARY KEY,
 organization_id TEXT NOT NULL
  CHECK (organization_id='synthetic-tenant-mp4-receipt'),
 receipt_sha256 CHAR(64) NOT NULL UNIQUE
  REFERENCES modo_hyperframes_staging.synthetic_receipt_attestations(receipt_sha256)
  ON DELETE RESTRICT,
 lease_fence UUID NOT NULL,
 storage_key UUID NOT NULL UNIQUE,
 output_sha256 CHAR(64) NOT NULL CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
 output_bytes INTEGER NOT NULL CHECK(output_bytes BETWEEN 4000 AND 25000000),
 finalized_ms BIGINT NOT NULL,
 expires_ms BIGINT NOT NULL CHECK (expires_ms>finalized_ms)
);
REVOKE ALL ON modo_hyperframes_staging.synthetic_encrypted_finalizations FROM PUBLIC;
REVOKE ALL ON modo_hyperframes_staging.synthetic_encrypted_finalizations
 FROM hf_staging_nonce_dispatcher,hf_staging_worker;

-- Only the existing NOLOGIN role executes the fixed SQL in the trigger.
GRANT INSERT ON modo_hyperframes_staging.synthetic_encrypted_finalizations
 TO hf_staging_lease_claim_owner;
GRANT SELECT (receipt_sha256,job_id,organization_id,lease_fence,
 output_sha256,output_bytes,committed_ms)
 ON modo_hyperframes_staging.synthetic_receipt_attestations
 TO hf_staging_lease_claim_owner;
GRANT SELECT (job_id,organization_id,lease_fence,lease_version,attempts,
 request_sha256,worker_id,signed_order_sha256)
 ON modo_hyperframes_staging.synthetic_lease_handoffs
 TO hf_staging_lease_claim_owner;
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;

CREATE OR REPLACE FUNCTION modo_hyperframes_staging.assert_synthetic_encrypted_finalization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $function$
DECLARE
 v_receipt CHAR(64);
 v_fence UUID;
 v_now BIGINT;
BEGIN
 IF TG_OP<>'INSERT' OR current_database()<>'modo_hyperframes_staging'
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_ENCRYPTED_FINALIZATION_DENIED'; END IF;
 -- Only this expressly synthetic lab fixture requires a signed receipt.
 -- All other isolated-staging artifact tests retain their existing behavior.
 IF NEW.organization_id<>'synthetic-tenant-mp4-receipt' THEN
  RETURN NEW;
 END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 SELECT a.receipt_sha256,a.lease_fence INTO v_receipt,v_fence
 FROM modo_hyperframes_staging.synthetic_receipt_attestations a
 JOIN modo_hyperframes_staging.synthetic_lease_handoffs h
   ON h.job_id=a.job_id AND h.organization_id=a.organization_id
   AND h.lease_fence=a.lease_fence
 JOIN modo_hyperframes_staging.render_jobs j
   ON j.job_id=a.job_id AND j.organization_id=a.organization_id
 WHERE a.job_id=NEW.job_id AND a.organization_id=NEW.organization_id
   AND a.output_sha256=NEW.sha256 AND a.output_bytes=NEW.byte_length
   AND a.committed_ms<=v_now
   AND j.project_id=j.document->>'projectId'
   AND j.status='running' AND j.version=h.lease_version
   AND j.attempts=h.attempts AND j.request_sha256=h.request_sha256
   AND j.lease_expires_ms>v_now
   AND j.document->>'previewOnly'='true'
   AND j.document->>'published'='false'
   AND j.document->'lease'->>'fence'=a.lease_fence::text
   AND j.document->'lease'->>'workerId'=h.worker_id
   AND h.signed_order_sha256 ~ '^[0-9a-f]{64}$';
 IF NOT FOUND THEN
  RAISE EXCEPTION 'HF_SYNTHETIC_ENCRYPTED_FINALIZATION_MISSING_RECEIPT';
 END IF;
 -- This INSERT shares the transaction used by the existing vault: if it,
 -- the ciphertext insert, OR the queue transition fails all are rolled back.
 INSERT INTO modo_hyperframes_staging.synthetic_encrypted_finalizations(
  job_id,organization_id,receipt_sha256,lease_fence,storage_key,
  output_sha256,output_bytes,finalized_ms,expires_ms)
 VALUES(NEW.job_id,NEW.organization_id,v_receipt,v_fence,NEW.storage_key,
  NEW.sha256,NEW.byte_length,v_now,NEW.expires_ms);
 RETURN NEW;
END
$function$;
ALTER FUNCTION modo_hyperframes_staging.assert_synthetic_encrypted_finalization()
 OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.assert_synthetic_encrypted_finalization()
 FROM PUBLIC,hf_staging_nonce_dispatcher,hf_staging_worker;
DROP TRIGGER IF EXISTS hf_synthetic_encrypted_artifact_receipt
 ON modo_hyperframes_staging.render_artifacts;
CREATE TRIGGER hf_synthetic_encrypted_artifact_receipt
 AFTER INSERT ON modo_hyperframes_staging.render_artifacts
 FOR EACH ROW EXECUTE FUNCTION modo_hyperframes_staging.assert_synthetic_encrypted_finalization();
COMMIT;
