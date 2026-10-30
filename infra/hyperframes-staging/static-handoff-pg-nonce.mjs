// Trusted Node-only synthetic PostgreSQL replay claims. NEVER browser code.
const SYN=/^synthetic-[a-z0-9-]{8,70}$/,ID=/^[a-z][a-z0-9-]{3,50}$/,
 HEX=/^[0-9a-f]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deny(){throw Error("HF_SYNTHETIC_NONCE_DENIED");}
function gate(){if(process.env.NODE_ENV==="production"||process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")deny();}
/**
 * Expected identity MUST come from scheduler-authorized immutable job data
 * independently checked against the Ed25519 handoff. Never trust browser IDs.
 * No authentication, routing or customer rendering is enabled.
 */
export function createSyntheticPgNonceConsumer(pool,expected){
 gate();
 if(!pool||typeof pool.connect!=="function"||!expected||
    typeof expected.tenantId!=="string"||!SYN.test(expected.tenantId)||
    typeof expected.jobId!=="string"||!SYN.test(expected.jobId)||
    typeof expected.workerId!=="string"||!ID.test(expected.workerId)||
    typeof expected.keyId!=="string"||!ID.test(expected.keyId)||
    typeof expected.orderSha256!=="string"||!HEX.test(expected.orderSha256))deny();
 const trusted={...expected};
 return async (tenantId,nonce,expiresAtMs)=>{
  gate();
  if(tenantId!==trusted.tenantId||typeof nonce!=="string"||!UUID.test(nonce)||
     !Number.isSafeInteger(expiresAtMs)||expiresAtMs<=0)deny();
  let client;
  try{
   client=await pool.connect();
   const check=await client.query("SELECT current_database() AS name");
   if(check.rows[0]?.name!=="modo_hyperframes_staging")deny();
   const result=await client.query(
    "INSERT INTO modo_hyperframes_staging.synthetic_handoff_nonces "+
    "(nonce,tenant_id,job_id,worker_id,key_id,order_sha256,claimed_ms,expires_ms) "+
    "SELECT $1::uuid,$2,$3,$4,$5,$6,clock.ms,$7::bigint "+
    "FROM (SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint AS ms) clock "+
    "WHERE $7::bigint>clock.ms AND $7::bigint<=clock.ms+60000 "+
    "ON CONFLICT (nonce) DO NOTHING RETURNING 1 AS claimed",
    [nonce,trusted.tenantId,trusted.jobId,trusted.workerId,trusted.keyId,trusted.orderSha256,expiresAtMs]);
   return result.rowCount===1;
  }catch(e){
   if(e?.message==="HF_SYNTHETIC_NONCE_DENIED")throw e;
   throw Error("HF_SYNTHETIC_NONCE_UNAVAILABLE");
  }finally{client?.release();}
 };
}
