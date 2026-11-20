/**
 * Synthetic trusted launcher gate; NOT a browser module or endpoint.
 * Guarantees a single POSTGRESQL admission consumption per lease/fence.
 * The caller must refuse to spawn Docker unless exactly one claim succeeds.
 * It does NOT prevent direct execution by anyone who stole a mounted permit.
 */
import {createHash} from "node:crypto";
import admissionVerifier from "./static-renderer-admission.cjs";
const {verifySyntheticRendererAdmission}=admissionVerifier;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
 SHA=/^[0-9a-f]{64}$/;
const deny=()=>{throw Error("HF_SYNTHETIC_BROWSER_LAUNCH_DENIED");};
const digest=b=>createHash("sha256").update(b).digest("hex");
function gate(){
 if(process.env.NODE_ENV==="production"||
   process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
   process.env.MODO_HF_PREFLIGHT_MODE!=="synthetic-ci-only"||
   process.env.MODO_HF_BROWSER_LAUNCH_MODE!=="synthetic-ci-only"||
   process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")deny();
}
const EXPECTED=["keyId","organizationId","projectId","jobId","workerId",
 "leaseFence","leaseVersion","attempts","requestSha256"];
export function createSyntheticBrowserLaunchGate(pool,trusted){
 gate();
 if(!pool||typeof pool.connect!=="function"||!trusted||
    !trusted.expectedLease||!UUID.test(trusted.expectedLease.jobId)||
    !UUID.test(trusted.expectedLease.leaseFence)||
    !SHA.test(trusted.admissionSha256)||
    !SHA.test(trusted.rendererOrderSha256)||
    !SHA.test(trusted.leaseOrderSha256)||
    trusted.expectedLease.organizationId!=="synthetic-tenant-mp4-receipt")deny();
 // Snapshot of independently authorized scheduler metadata, not from envelope.
 const authorized={
   expectedLease:{...trusted.expectedLease},
   admissionSha256:trusted.admissionSha256,
   rendererJobId:trusted.rendererJobId,
   rendererOrderSha256:trusted.rendererOrderSha256,
   leaseOrderSha256:trusted.leaseOrderSha256
 };
 return async ({envelope,publicKey,rendererOrderBytes,rendererPayload})=>{
  gate();
  // Validates signed bytes, public Ed25519 signature, renderer request digest,
  // purpose, issue time and expiry before any DB insert.
  const verified=verifySyntheticRendererAdmission(
    envelope,publicKey,rendererOrderBytes,rendererPayload);
  const bytes=Buffer.from(envelope.payloadB64,"base64url");
  let p;try{p=JSON.parse(bytes.toString("utf8"));}catch{deny();}
  if(!p||verified.jobId!==authorized.expectedLease.jobId||
     verified.leaseFence!==authorized.expectedLease.leaseFence||
     p.organizationId!=="synthetic-tenant-mp4-receipt"||
     !EXPECTED.every(k=>k==="keyId" ? true :
       (p[k]===authorized.expectedLease[k]))||
     p.rendererJobId!==authorized.rendererJobId||
     p.rendererOrderSha256!==authorized.rendererOrderSha256||
     p.leaseOrderSha256!==authorized.leaseOrderSha256||
     digest(rendererOrderBytes)!==authorized.rendererOrderSha256||
     digest(bytes)!==authorized.admissionSha256)deny();
  let client;
  try{
   client=await pool.connect();
   const db=await client.query("SELECT current_database() AS name");
   if(db.rows[0]?.name!=="modo_hyperframes_staging")deny();
   const result=await client.query(
    "SELECT modo_hyperframes_staging.consume_synthetic_browser_launch("+
    "$1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,"+
    "$7::integer,$8::smallint,$9::text,$10::text,$11::text,$12::text,"+
    "$13::bigint) AS claimed",
    [p.nonce,p.jobId,p.organizationId,p.projectId,p.workerId,p.leaseFence,
     p.leaseVersion,p.attempts,p.requestSha256,p.leaseOrderSha256,
     p.rendererOrderSha256,authorized.admissionSha256,p.expiresAtMs]
   );
   return result.rowCount===1&&result.rows[0].claimed===true;
  }catch(e){
   if(e?.message==="HF_SYNTHETIC_BROWSER_LAUNCH_DENIED")throw e;
   throw Error("HF_SYNTHETIC_BROWSER_LAUNCH_DB_UNAVAILABLE");
  }finally{client?.release();}
 };
}
