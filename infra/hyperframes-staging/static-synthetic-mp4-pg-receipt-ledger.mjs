/**
 * Trusted-side receipt attestation ledger, synthetic CI only.
 * Verifies Ed25519 receipt against independently measured real MP4 bytes
 * before a PostgreSQL row-locked, fencing-aware INSERT.
 * This stores ONLY proof metadata; it is NOT durable MP4 storage or a job finish.
 */
import {verifySyntheticMp4LeaseReceipt} from "./static-lease-mp4-receipt-v2.mjs";
function gate(){
 if(process.env.NODE_ENV==="production"||
  process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
  process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
  process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")
  throw Error("HF_SYNTHETIC_RECEIPT_LEDGER_DISABLED");
}
export async function commitVerifiedSyntheticMp4Receipt({
 pool,envelope,publicKeys,revokedKeyIds=[],expected,currentJob,observed
}){
 gate();
 if(!pool||typeof pool.connect!=="function")
  throw Error("HF_SYNTHETIC_RECEIPT_LEDGER_DENIED");
 const verified=verifySyntheticMp4LeaseReceipt({
  envelope,publicKeys,revokedKeyIds,expected,currentJob,observed,
  nowMs:Date.now()
 });
 const p=verified.payload;
 let client;
 try{
  client=await pool.connect();
  const db=await client.query("SELECT current_database() AS name");
  if(db.rows[0]?.name!=="modo_hyperframes_staging")
   throw Error("HF_SYNTHETIC_RECEIPT_LEDGER_DENIED");
  const result=await client.query(
   "SELECT modo_hyperframes_staging.commit_synthetic_mp4_receipt("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,"+
   "$11::text,$12::integer) AS recorded",
   [p.jobId,p.organizationId,p.projectId,p.workerId,p.leaseFence,
    p.leaseVersion,p.attempts,p.requestSha256,p.leaseOrderSha256,
    verified.receiptSha256,p.outputSha256,p.outputBytes]
  );
  return {recorded:result.rowCount===1 && result.rows[0]?.recorded===true,
   receiptSha256:verified.receiptSha256,outputSha256:p.outputSha256,
   jobId:p.jobId,leaseFence:p.leaseFence};
 }catch(e){
  if(e?.message==="HF_SYNTHETIC_RECEIPT_LEDGER_DENIED")throw e;
  throw Error("HF_SYNTHETIC_RECEIPT_LEDGER_UNAVAILABLE");
 }finally{client?.release();}
}
