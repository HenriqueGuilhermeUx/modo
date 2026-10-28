/**
 * Synthetic-only Ed25519 v2 lease-bound claim: Node trusted scheduler only.
 * The actual browser has no pool, credentials, socket, publisher or routes.
 * A SQL row lock serializes the claim against queue lease transitions.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
 SYN=/^synthetic-[a-z0-9-]{8,70}$/,HEX=/^[0-9a-f]{64}$/;
function deny(){throw Error("HF_SYNTHETIC_LEASE_DB_DENIED");}
function gate(){
 if(process.env.NODE_ENV==="production"||
   process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
   process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")deny();
}
const FIELDS=["organizationId","projectId","jobId","workerId",
 "leaseFence","leaseVersion","attempts","requestSha256","keyId"];
/**
 * expected is a snapshot received from an authenticated scheduler that
 * independently authorized and claimed a real staging queue lease.
 * This adapter is not itself service authentication.
 */
export function createSyntheticLeasePgClaim(pool,expected){
 gate();
 if(!pool||typeof pool.connect!=="function"||!expected||
    typeof expected.organizationId!=="string"||!SYN.test(expected.organizationId)||
    !UUID.test(expected.projectId)||!UUID.test(expected.jobId)||
    !UUID.test(expected.leaseFence)||!HEX.test(expected.requestSha256)||
    !Number.isSafeInteger(expected.leaseVersion)||expected.leaseVersion<=0||
    !Number.isSafeInteger(expected.attempts)||expected.attempts<1||expected.attempts>3)deny();
 const trusted={...expected};
 return async (payload,signedOrderSha256)=>{
  gate();
  if(!payload||!FIELDS.every(k=>trusted[k]===payload[k])||
     typeof payload.nonce!=="string"||!UUID.test(payload.nonce)||
     typeof signedOrderSha256!=="string"||!HEX.test(signedOrderSha256)||
     !Number.isSafeInteger(payload.expiresAtMs))deny();
  let client;
  try{
   client=await pool.connect();
   const db=await client.query("SELECT current_database() AS name");
   if(db.rows[0]?.name!=="modo_hyperframes_staging")deny();
   // Lock the current lease's row until the statement commits. A competing
   // claim/heartbeat/fail/finish must observe serialization.
   const statement=
    "WITH clock AS MATERIALIZED "+
    "(SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms), "+
    "eligible AS MATERIALIZED ("+
    " SELECT j.job_id,j.organization_id FROM modo_hyperframes_staging.render_jobs j "+
    " CROSS JOIN clock "+
    " WHERE j.job_id=$2::uuid AND j.organization_id=$3 "+
    " AND j.project_id=$4::text AND j.request_sha256=$5 "+
    " AND j.status='running' AND j.version=$6 AND j.attempts=$7 "+
    " AND j.document->>'previewOnly'='true' "+
    " AND j.document->>'published'='false' "+
    " AND j.document->'lease'->>'workerId'=$8 "+
    " AND j.document->'lease'->>'fence'=$9 "+
    " AND j.lease_expires_ms>clock.ms "+
    " FOR SHARE OF j) "+
    "INSERT INTO modo_hyperframes_staging.synthetic_lease_handoffs "+
    "(nonce,job_id,organization_id,worker_id,lease_fence,lease_version,"+
    "attempts,request_sha256,signed_order_sha256,claimed_ms,expires_ms) "+
    "SELECT $1::uuid,eligible.job_id,eligible.organization_id,$8,$9::uuid,"+
    "$6,$7,$5,$10,clock.ms,$11::bigint FROM eligible CROSS JOIN clock "+
    "WHERE $11::bigint>clock.ms AND $11::bigint<=clock.ms+60000 "+
    "ON CONFLICT DO NOTHING RETURNING 1 AS accepted";
   const result=await client.query(statement,[
    payload.nonce,trusted.jobId,trusted.organizationId,trusted.projectId,
    trusted.requestSha256,trusted.leaseVersion,trusted.attempts,
    trusted.workerId,trusted.leaseFence,signedOrderSha256,payload.expiresAtMs
   ]);
   return result.rowCount===1;
  }catch(e){
   if(e?.message==="HF_SYNTHETIC_LEASE_DB_DENIED")throw e;
   throw Error("HF_SYNTHETIC_LEASE_DB_UNAVAILABLE");
  }finally{client?.release();}
 };
}
