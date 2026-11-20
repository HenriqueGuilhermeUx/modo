/**
 * Trusted sidecar: validates Ed25519 v3 continuation + observed H264 output
 * under one live PostgreSQL job row-lock, then commits ONLY v3 proof metadata.
 * Never writes an MP4 artifact or makes a publication available.
 */
import {verifySyntheticMp4OutputReceiptV3}
 from "./static-lease-mp4-receipt-v3.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deny=()=>{throw Error("HF_SYNTHETIC_V3_OUTPUT_LEDGER_DENIED");};
export async function commitVerifiedSyntheticMp4OutputV3({
 pool,jobId,tenant,leaseFence,envelope,publicKeys,revokedKeyIds=[],
 continuationEnvelope,continuationPublicKeys,revokedContinuationKeyIds=[],
 observed
}){
 if(process.env.NODE_ENV==="production"||
  process.env.MODO_HF_CONTINUATION_V3_MODE!=="synthetic-ci-only"||
  process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
  process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
  process.env.MODO_HYPERFRAMES_RECOVERY_MODE!=="isolated-staging"||
  typeof pool?.connect!=="function"||
  tenant!=="synthetic-tenant-mp4-receipt"||
  typeof jobId!=="string"||!UUID.test(jobId)||
  typeof leaseFence!=="string"||!UUID.test(leaseFence))deny();
 const client=await pool.connect();let active=false;
 try{
  await client.query("BEGIN");active=true;
  await client.query("SET LOCAL ROLE hf_staging_nonce_dispatcher");
  const {rows}=await client.query(
   "SELECT current_database() AS database_name,"+
   "modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot("+
   "$1::uuid,$2::text,$3::uuid) AS snapshot",
   [jobId,tenant,leaseFence]);
  if(rows.length!==1||rows[0].database_name!=="modo_hyperframes_staging"||
   !rows[0].snapshot)deny();
  const context=rows[0].snapshot;
  const accepted=verifySyntheticMp4OutputReceiptV3({
   envelope,publicKeys,revokedKeyIds,continuationEnvelope,
   continuationPublicKeys,revokedContinuationKeyIds,
   context,observed,nowMs:context.nowMs});
  const p=accepted.payload;
  if(p.jobId!==jobId||p.organizationId!==tenant||p.leaseFence!==leaseFence)deny();
  const result=await client.query(
   "SELECT modo_hyperframes_staging.commit_synthetic_mp4_output_v3("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,"+
   "$11::smallint,$12::text,$13::text,$14::text,$15::integer) AS recorded",
   [p.jobId,p.organizationId,p.projectId,p.workerId,p.leaseFence,
    p.leaseVersion,p.attempts,p.requestSha256,p.dispatchSha256,
    p.admissionSha256,p.epoch,p.continuationSha256,
    accepted.receiptSha256,p.outputSha256,p.outputBytes]);
  await client.query("COMMIT");active=false;
  return {recorded:result.rows[0]?.recorded===true,
   receiptSha256:accepted.receiptSha256,continuationSha256:accepted.continuationSha256,
   outputSha256:p.outputSha256,epoch:p.epoch,
   storageAllowed:false,publicationAllowed:false};
 }finally{
  if(active)await client.query("ROLLBACK").catch(()=>{});
  client.release();
 }
}
