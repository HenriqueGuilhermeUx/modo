/**
 * Live disposable PostgreSQL proof for migration 011.
 * Never reads customer data or writes signed MP4 receipts.
 */
import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,createHash} from "node:crypto";
import pg from "pg";
import {HyperframesStagingPgQueue} from
 "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {issueSyntheticLeaseContinuationV3FromPg,
 verifySyntheticLeaseContinuationV3AgainstPg}
 from "./static-lease-continuation-v3-pg.mjs";
const url=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!url)throw Error("HF_SYNTHETIC_V3_PG_TEST_DB_REQUIRED");
const {Pool}=pg,tenant="synthetic-tenant-mp4-receipt",worker="worker-ci-one";
const keys=generateKeyPairSync("ed25519"),keyId="trusted-renewal-v3-ci";
const sha=x=>createHash("sha256").update(x).digest("hex");
let pool,queue;
before(async()=>{
 process.env.MODO_HF_CONTINUATION_V3_MODE="synthetic-ci-only";
 process.env.MODO_HYPERFRAMES_DB_MODE="isolated-staging";
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE="isolated-staging";
 pool=new Pool({connectionString:url,ssl:false,max:12});
 queue=new HyperframesStagingPgQueue(pool);
 const {rows}=await pool.query("SELECT current_database() AS name");
 assert.equal(rows[0].name,"modo_hyperframes_staging");
});
after(async()=>{await pool?.end();});
async function fixture(){
 const job=await queue.enqueue({organizationId:tenant,projectId:randomUUID(),
  requestSha256:sha("request-"+randomUUID()),
  idempotencyKey:"v3pg-"+randomUUID()},tenant);
 const lease=await queue.claim(job.jobId,tenant,worker,60000);
 assert.equal(lease.status,"running");
 const now=Date.now(),dispatchSha=sha("dispatch-"+randomUUID()),
  admissionSha=sha("admission-"+randomUUID());
 await pool.query(
  "INSERT INTO modo_hyperframes_staging.synthetic_lease_handoffs "+
  "(nonce,job_id,organization_id,worker_id,lease_fence,lease_version,"+
  "attempts,request_sha256,signed_order_sha256,claimed_ms,expires_ms) "+
  "VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7::smallint,$8,$9,$10,$11)",
  [randomUUID(),lease.jobId,tenant,worker,lease.lease.fence,
   lease.version,lease.attempts,lease.requestSha256,dispatchSha,now,now+40000]);
 await pool.query(
  "INSERT INTO modo_hyperframes_staging.synthetic_browser_launches "+
  "(nonce,job_id,organization_id,lease_fence,admission_sha256,"+
  "renderer_order_sha256,dispatch_sha256,launched_ms,expires_ms) "+
  "VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9)",
  [randomUUID(),lease.jobId,tenant,lease.lease.fence,admissionSha,
   sha("renderer-"+randomUUID()),dispatchSha,now,now+35000]);
 return {lease,params:[lease.jobId,tenant,lease.projectId,worker,
  lease.lease.fence,lease.version,lease.attempts,lease.requestSha256,
  dispatchSha,admissionSha,60000]};
}
async function renew(params){
 const client=await pool.connect();let began=false;
 try{
  await client.query("BEGIN");began=true;
  await client.query("SET LOCAL ROLE hf_staging_nonce_dispatcher");
  const {rows}=await client.query(
   "SELECT renewed,lease_version,expires_ms FROM "+
   "modo_hyperframes_staging.renew_synthetic_lease_epoch("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,$11::integer)",
   params);
  await client.query("COMMIT");began=false;
  return rows[0];
 }finally{
  if(began)await client.query("ROLLBACK").catch(()=>{});
  client.release();
 }
}
const args=f=>({pool,jobId:f.lease.jobId,tenant,
 leaseFence:f.lease.lease.fence});
const issued=f=>issueSyntheticLeaseContinuationV3FromPg({
 ...args(f),keyId,privateKey:keys.privateKey,publicKey:keys.publicKey});
const verified=(f,envelope)=>verifySyntheticLeaseContinuationV3AgainstPg({
 ...args(f),envelope,publicKeys:{[keyId]:keys.publicKey}});
test("NO renewal means no continuation: no guessed epoch can be signed",async()=>{
 const f=await fixture();
 await assert.rejects(issued(f),/HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
});
test("real SQL epoch -> trusted row-lock snapshot -> signed Ed25519 proof",async()=>{
 const f=await fixture();
 const one=await renew(f.params);assert.equal(one.renewed,true);
 const out=await issued(f);
 assert.equal(out.verified.epoch,1);
 assert.equal(out.verified.leaseVersion,one.lease_version);
 const check=await verified(f,out.envelope);
 assert.equal(check.continuationSha256,out.verified.continuationSha256);
 assert.equal(await pool.query(
  "SELECT count(*)::int AS total FROM modo_hyperframes_staging.synthetic_receipt_attestations "+
  "WHERE job_id=$1::uuid",[f.lease.jobId]).then(r=>r.rows[0].total),0);
 assert.equal(JSON.stringify(out).includes("privateKey"),false);
});
test("a second true SQL renewal invalidates the first signed continuation",async()=>{
 const f=await fixture();
 const one=await renew(f.params);assert.equal(one.renewed,true);
 const old=await issued(f);
 const changed=[...f.params];changed[5]=one.lease_version;
 const two=await renew(changed);assert.equal(two.renewed,true);
 await assert.rejects(verified(f,old.envelope),
  /HF_SYNTHETIC_LEASE_CONTINUATION_V3_DENIED/);
 const next=await issued(f);
 assert.equal(next.verified.epoch,2);
 assert.equal(next.verified.leaseVersion,two.lease_version);
 assert.equal((await verified(f,next.envelope)).epoch,2);
});
test("bad tenant, stale fence, expired lease and completed job deny even with signing key",async()=>{
 const f=await fixture();
 assert.equal((await renew(f.params)).renewed,true);
 await assert.rejects(issueSyntheticLeaseContinuationV3FromPg({
  ...args(f),tenant:"synthetic-other-tenant",keyId,
  privateKey:keys.privateKey,publicKey:keys.publicKey
 }),/HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
 await assert.rejects(issueSyntheticLeaseContinuationV3FromPg({
  ...args(f),leaseFence:randomUUID(),keyId,
  privateKey:keys.privateKey,publicKey:keys.publicKey
 }),/HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
 const token=await issued(f);
 await assert.rejects(verifySyntheticLeaseContinuationV3AgainstPg({
  ...args(f),envelope:token.envelope,
  publicKeys:{[keyId]:keys.publicKey},revokedKeyIds:[keyId]
 }),/HF_SYNTHETIC_LEASE_CONTINUATION_V3_DENIED/);
 const expired=await fixture();assert.equal((await renew(expired.params)).renewed,true);
 await pool.query("UPDATE modo_hyperframes_staging.render_jobs "+
  "SET lease_expires_ms=$2,document=jsonb_set(document,"+
  "'{lease,expiresAt}',to_jsonb($2::bigint)) "+
  "WHERE job_id=$1::uuid",[expired.lease.jobId,Date.now()-1000]);
 await assert.rejects(issued(expired),
  /HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
 const terminal=await fixture();assert.equal((await renew(terminal.params)).renewed,true);
 await pool.query("UPDATE modo_hyperframes_staging.render_jobs "+
  "SET status='succeeded',document=jsonb_set(document,'{status}',"+
  "'\"succeeded\"'::jsonb) WHERE job_id=$1::uuid",[terminal.lease.jobId]);
 await assert.rejects(issued(terminal),
  /HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
});
test("limited dispatcher executes snapshot but cannot directly SELECT tables; worker cannot execute",async()=>{
 const {rows}=await pool.query("SELECT "+
  "has_function_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(uuid,text,uuid)',"+
  "'EXECUTE') AS dispatcher_can_read,"+
  "has_function_privilege('hf_staging_worker',"+
  "'modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot(uuid,text,uuid)',"+
  "'EXECUTE') AS worker_can_read,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.render_jobs','SELECT') AS direct_queue,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.synthetic_lease_renewal_epochs','SELECT') AS direct_epoch");
 assert.deepEqual(rows,[{dispatcher_can_read:true,worker_can_read:false,
  direct_queue:false,direct_epoch:false}]);
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE hf_staging_worker");
  await assert.rejects(client.query(
   "SELECT modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot("+
   "$1::uuid,$2::text,$3::uuid)",
   [f.lease.jobId,tenant,f.lease.lease.fence]),/permission denied/);
  await client.query("ROLLBACK");
 }finally{client.release();}
});
test("database snapshot waits behind row lock, refuses stale queue after conflicting status change",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const client=await pool.connect();let locked=false;
 try{
  await client.query("BEGIN");locked=true;
  await client.query("SELECT job_id FROM modo_hyperframes_staging.render_jobs "+
   "WHERE job_id=$1::uuid FOR UPDATE",[f.lease.jobId]);
  let settled=false;
  const pending=issued(f).then(x=>{settled=true;return x;},
   e=>{settled=true;throw e;});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(settled,false,"snapshot must wait for queue lock");
  await client.query("UPDATE modo_hyperframes_staging.render_jobs "+
   "SET status='failed',document=jsonb_set(document,'{status}',"+
   "'\"failed\"'::jsonb) WHERE job_id=$1::uuid",[f.lease.jobId]);
  await client.query("COMMIT");locked=false;
  await assert.rejects(pending,/HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
 }finally{
  if(locked)await client.query("ROLLBACK").catch(()=>{});
  client.release();
 }
});
