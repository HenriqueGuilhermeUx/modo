-- 011: authorized synthetic-only READ snapshot for signed continuation v3.
-- NO MP4 receipt/finalization after renewal; 010 receipt barrier stays.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
   to_regclass('modo_hyperframes_staging.synthetic_lease_renewal_epochs') IS NULL
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_SNAPSHOT_WRONG_DATABASE'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_lease_claim_owner'
  AND NOT rolcanlogin AND NOT rolsuper) OR
  NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'
  AND NOT rolcanlogin AND NOT rolsuper)
 THEN RAISE EXCEPTION 'HF_SYNTHETIC_V3_SNAPSHOT_WRONG_ROLES'; END IF;
END
$guard$;

-- Only the existing NOLOGIN SECURITY DEFINER owner may see epoch contents.
GRANT SELECT (job_id,organization_id,lease_fence,from_version,to_version,attempts,
 dispatch_sha256,admission_sha256,renewed_ms,expires_ms)
 ON modo_hyperframes_staging.synthetic_lease_renewal_epochs
 TO hf_staging_lease_claim_owner;
GRANT CREATE ON SCHEMA modo_hyperframes_staging TO hf_staging_lease_claim_owner;
CREATE OR REPLACE FUNCTION modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(
 p_job UUID,p_tenant TEXT,p_fence UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,modo_hyperframes_staging
AS $snapshot$
DECLARE
 v_job RECORD;
 v_dispatch RECORD;
 v_launch RECORD;
 v_epochs JSONB;
 v_num INTEGER;
 v_now BIGINT;
 v_last JSONB;
 v_first JSONB;
BEGIN
 IF current_database()<>'modo_hyperframes_staging' OR
  p_tenant IS DISTINCT FROM 'synthetic-tenant-mp4-receipt' OR
  p_job IS NULL OR p_fence IS NULL THEN RETURN NULL; END IF;
 -- Lock CURRENT queue row before clock/read. Competing renewal/finish/fail
 -- must acquire an incompatible lock and cannot slip between job + epochs.
 SELECT j.project_id,j.request_sha256,j.version,j.status,j.attempts,
  j.lease_expires_ms,j.document
 INTO v_job
 FROM modo_hyperframes_staging.render_jobs j
 WHERE j.job_id=p_job AND j.organization_id=p_tenant
  AND j.status='running' AND j.document->>'previewOnly'='true'
  AND j.document->>'published'='false'
  AND j.document->'lease'->>'fence'=p_fence::text
 FOR SHARE OF j;
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_job.lease_expires_ms IS NULL OR v_job.lease_expires_ms<=v_now OR
  v_job.version<2 OR v_job.attempts NOT BETWEEN 1 AND 3 OR
  v_job.document->>'status'<>'running' OR
  (v_job.document->>'version')::INTEGER<>v_job.version OR
  (v_job.document->'lease'->>'expiresAt')::BIGINT<>v_job.lease_expires_ms OR
  v_job.document->'lease'->>'workerId' IS NULL THEN RETURN NULL; END IF;

 SELECT h.lease_version,h.worker_id,h.attempts,h.request_sha256,
  h.signed_order_sha256
 INTO v_dispatch
 FROM modo_hyperframes_staging.synthetic_lease_handoffs h
 WHERE h.job_id=p_job AND h.organization_id=p_tenant
  AND h.lease_fence=p_fence AND h.attempts=v_job.attempts
  AND h.request_sha256=v_job.request_sha256
  AND h.worker_id=v_job.document->'lease'->>'workerId';
 IF NOT FOUND THEN RETURN NULL; END IF;

 SELECT b.admission_sha256,b.dispatch_sha256,b.renderer_order_sha256,b.launched_ms
 INTO v_launch
 FROM modo_hyperframes_staging.synthetic_browser_launches b
 WHERE b.job_id=p_job AND b.organization_id=p_tenant
  AND b.lease_fence=p_fence
  AND b.dispatch_sha256=v_dispatch.signed_order_sha256;
 IF NOT FOUND OR v_launch.launched_ms IS NULL OR
  v_launch.launched_ms<=0 OR
  v_now>v_launch.launched_ms+120000 OR
  v_job.lease_expires_ms>v_launch.launched_ms+120000 THEN RETURN NULL; END IF;

 SELECT count(*)::integer,coalesce(jsonb_agg(jsonb_build_object(
   'jobId',e.job_id::text,'organizationId',e.organization_id,
   'leaseFence',e.lease_fence::text,'fromVersion',e.from_version,
   'toVersion',e.to_version,'attempts',e.attempts,
   'dispatchSha256',trim(e.dispatch_sha256),
   'admissionSha256',trim(e.admission_sha256),
   'renewedMs',e.renewed_ms,'expiresMs',e.expires_ms)
  ORDER BY e.to_version),'[]'::jsonb)
 INTO v_num,v_epochs
 FROM modo_hyperframes_staging.synthetic_lease_renewal_epochs e
 WHERE e.job_id=p_job AND e.organization_id=p_tenant
  AND e.lease_fence=p_fence;
 IF v_num NOT BETWEEN 1 AND 2 THEN RETURN NULL; END IF;
 v_first:=v_epochs->0;v_last:=v_epochs->(v_num-1);
 -- Fail closed on nonconsecutive renewal or queue/epoch drift; the JS
 -- verifier independently checks these facts again before attestation.
 IF (v_first->>'fromVersion')::INTEGER<>v_dispatch.lease_version OR
  (v_last->>'toVersion')::INTEGER<>v_job.version OR
  (v_last->>'expiresMs')::BIGINT<>v_job.lease_expires_ms OR
  (v_num=2 AND (
    (v_epochs->1->>'fromVersion')::INTEGER<>
      (v_epochs->0->>'toVersion')::INTEGER OR
    (v_epochs->1->>'expiresMs')::BIGINT<=
      (v_epochs->0->>'expiresMs')::BIGINT)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM modo_hyperframes_staging.synthetic_receipt_attestations a
  WHERE a.job_id=p_job AND a.lease_fence=p_fence) OR
  EXISTS(SELECT 1 FROM modo_hyperframes_staging.synthetic_encrypted_finalizations f
  WHERE f.job_id=p_job AND f.lease_fence=p_fence) THEN RETURN NULL; END IF;

 RETURN jsonb_build_object(
  'nowMs',v_now,
  'currentJob',jsonb_build_object(
   'jobId',p_job::text,'organizationId',p_tenant,
   'projectId',v_job.project_id,'status','running',
   'previewOnly',true,'published',false,'version',v_job.version,
   'attempts',v_job.attempts,'requestSha256',trim(v_job.request_sha256),
   'lease',jsonb_build_object('fence',p_fence::text,
    'workerId',v_job.document->'lease'->>'workerId',
    'expiresAt',v_job.lease_expires_ms)),
  'launch',jsonb_build_object(
   'jobId',p_job::text,'organizationId',p_tenant,
   'leaseFence',p_fence::text,
   'dispatchSha256',trim(v_launch.dispatch_sha256),
   'admissionSha256',trim(v_launch.admission_sha256),
   'rendererOrderSha256',trim(v_launch.renderer_order_sha256),
   'launchedMs',v_launch.launched_ms),
  'epochs',v_epochs);
END
$snapshot$;
ALTER FUNCTION modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(
 UUID,TEXT,UUID) OWNER TO hf_staging_lease_claim_owner;
REVOKE CREATE ON SCHEMA modo_hyperframes_staging FROM hf_staging_lease_claim_owner;
REVOKE ALL ON FUNCTION modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(
 UUID,TEXT,UUID) FROM PUBLIC,hf_staging_worker;
GRANT EXECUTE ON FUNCTION modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(
 UUID,TEXT,UUID) TO hf_staging_nonce_dispatcher;
-- No direct queue, epoch or launch SELECT granted to dispatcher.
COMMIT;
