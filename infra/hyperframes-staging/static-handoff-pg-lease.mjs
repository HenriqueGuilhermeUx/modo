/**
 * Synthetic-only lease-bound dispatch. Trusted Node scheduler only, NEVER
 * bundled in Chrome. DB SECURITY DEFINER function owns the row lock.
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
   // SQL function with hardened SECURITY DEFINER is narrowly granted to the
   // dispatcher. Its own NOLOGIN owner holds the row-lock privilege.
   const result=await client.query(
    "SELECT modo_hyperframes_staging.consume_synthetic_lease("+
    "$1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid,"+
    "$7::integer,$8::smallint,$9::text,$10::text,$11::bigint) AS claimed",
    [payload.nonce,trusted.jobId,trusted.organizationId,trusted.projectId,
     trusted.workerId,trusted.leaseFence,trusted.leaseVersion,
     trusted.attempts,trusted.requestSha256,signedOrderSha256,payload.expiresAtMs]
   );
   return result.rowCount===1&&result.rows[0].claimed===true;
  }catch(e){
   if(e?.message==="HF_SYNTHETIC_LEASE_DB_DENIED")throw e;
   throw Error("HF_SYNTHETIC_LEASE_DB_UNAVAILABLE");
  }finally{client?.release();}
 };
}
