/**
 * Trusted-HOST only, PostgreSQL-backed signed v3 continuation attestation.
 * Private Ed25519 key stays in host RAM. Browser cannot call this module.
 * Does NOT grant finalization of a renewed MP4 (migration 010 still blocks it).
 */
import {signSyntheticLeaseContinuationV3,verifySyntheticLeaseContinuationV3}
 from "./static-lease-continuation-v3.mjs";
const DENY=()=>{throw Error("HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED");};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function gate({pool,jobId,tenant,leaseFence}){
 if(process.env.NODE_ENV==="production"||
  process.env.MODO_HF_CONTINUATION_V3_MODE!=="synthetic-ci-only"||
  process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
  process.env.MODO_HYPERFRAMES_RECOVERY_MODE!=="isolated-staging"||
  tenant!=="synthetic-tenant-mp4-receipt"||
  typeof jobId!=="string"||!UUID.test(jobId)||
  typeof leaseFence!=="string"||!UUID.test(leaseFence)||
  typeof pool?.connect!=="function")DENY();
}
async function transaction({pool,jobId,tenant,leaseFence,inspect}){
 gate({pool,jobId,tenant,leaseFence});
 const client=await pool.connect();
 let began=false;
 try{
  await client.query("BEGIN");began=true;
  // Only the trusted host controls this SQL. The NOLOGIN dispatcher has
  // EXECUTE on a SECURITY DEFINER function, not direct table reads/writes.
  await client.query("SET LOCAL ROLE hf_staging_nonce_dispatcher");
  const {rows}=await client.query(
   "SELECT current_database() AS database_name, "+
   "modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot("+
   "$1::uuid,$2::text,$3::uuid) AS snapshot",
   [jobId,tenant,leaseFence]);
  if(rows.length!==1||rows[0].database_name!=="modo_hyperframes_staging"||
    !rows[0].snapshot)DENY();
  const context=rows[0].snapshot;
  if(!Number.isSafeInteger(context.nowMs)||
   !Array.isArray(context.epochs)||!context.currentJob||!context.launch||
   context.currentJob.jobId!==jobId||
   context.currentJob.lease?.fence!==leaseFence)DENY();
  // Do any Ed25519 signing/verification WHILE row's FOR SHARE lock is held.
  // Subsequent renewals may invalidate the old proof after this transaction;
  // every consumer must re-check the latest snapshot, not trust a stale token.
  const result=await inspect(context);
  await client.query("COMMIT");began=false;
  return result;
 }catch(e){
  if(began)await client.query("ROLLBACK").catch(()=>undefined);
  throw e;
 }finally{
  client.release();
 }
}
function payloadFromSnapshot(context,keyId){
 const job=context.currentJob,last=context.epochs.at(-1),launch=context.launch;
 if(!last)DENY();
 return {version:3,audience:"modo-hf-renewed-lease-continuation-synthetic-v3",
  issuer:"trusted-synthetic-renewal-attestor",keyId,
  organizationId:job.organizationId,projectId:job.projectId,
  jobId:job.jobId,workerId:job.lease.workerId,
  leaseFence:job.lease.fence,leaseVersion:job.version,
  attempts:job.attempts,requestSha256:job.requestSha256,
  dispatchSha256:launch.dispatchSha256,
  admissionSha256:launch.admissionSha256,
  epoch:context.epochs.length,previousVersion:last.fromVersion,
  expiresAtMs:job.lease.expiresAt,issuedAtMs:context.nowMs};
}
export async function issueSyntheticLeaseContinuationV3FromPg({
 pool,jobId,tenant,leaseFence,keyId,privateKey,publicKey
}){
 if(privateKey?.asymmetricKeyType!=="ed25519"||
  publicKey?.asymmetricKeyType!=="ed25519"||
  typeof keyId!=="string")DENY();
 return transaction({pool,jobId,tenant,leaseFence,inspect:context=>{
  const payload=payloadFromSnapshot(context,keyId);
  const envelope=signSyntheticLeaseContinuationV3({payload,privateKey,context});
  const verified=verifySyntheticLeaseContinuationV3({
   envelope,publicKeys:{[keyId]:publicKey},context,nowMs:context.nowMs});
  return {envelope,verified};
 }});
}
export async function verifySyntheticLeaseContinuationV3AgainstPg({
 pool,jobId,tenant,leaseFence,envelope,publicKeys,revokedKeyIds=[]
}){
 return transaction({pool,jobId,tenant,leaseFence,inspect:context=>
  verifySyntheticLeaseContinuationV3({
   envelope,publicKeys,revokedKeyIds,context,nowMs:context.nowMs})
 });
}
