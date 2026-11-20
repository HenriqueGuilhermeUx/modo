/**
 * Database-only contract for isolated 010 renewal. Signed browser admission
 * and dispatch are covered separately by E2E. These test fixture records are
 * never accepted as real media or provided to the Chrome container.
 */
import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash,generateKeyPairSync} from "node:crypto";
import pg from "pg";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {signSyntheticMp4LeaseReceipt,verifySyntheticMp4LeaseReceipt}
 from "./static-lease-mp4-receipt-v2.mjs";
const url=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!url)throw Error("HF_RENEWAL_PG_TEST_DATABASE_REQUIRED");
const {Pool}=pg;
const tenant="synthetic-tenant-mp4-receipt",worker="worker-ci-one";
const digest=x=>createHash("sha256").update(x).digest("hex");
let root,restricted,queue;
async function fixture({withLaunch=true}={}){
 const job=await queue.enqueue({organizationId:tenant,projectId:randomUUID(),
  idempotencyKey:"renewal-"+randomUUID(),
  requestSha256:digest("renewal-"+randomUUID())},tenant);
 const lease=await queue.claim(job.jobId,tenant,worker,60000);
 assert.equal(lease?.status,"running");
 const now=Date.now();
 const dispatch=digest("dispatch-"+randomUUID());
 const admission=digest("admission-"+randomUUID());
 const claim=await root.query(
  "INSERT INTO modo_hyperframes_staging.synthetic_lease_handoffs "+
  "(nonce,job_id,organization_id,worker_id,lease_fence,lease_version,"+
  "attempts,request_sha256,signed_order_sha256,claimed_ms,expires_ms) "+
  "VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7::smallint,$8,$9,$10,$11)",
  [randomUUID(),lease.jobId,tenant,worker,lease.lease.fence,lease.version,
   lease.attempts,lease.requestSha256,dispatch,now,now+40000]);
 assert.equal(claim.rowCount,1);
 if(withLaunch){
  await root.query(
   "INSERT INTO modo_hyperframes_staging.synthetic_browser_launches "+
   "(nonce,job_id,organization_id,lease_fence,admission_sha256,"+
   "renderer_order_sha256,dispatch_sha256,launched_ms,expires_ms) "+
   "VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9)",
   [randomUUID(),lease.jobId,tenant,lease.lease.fence,admission,
    digest("renderer-"+randomUUID()),dispatch,now,now+35000]);
 }
 return {lease,dispatch,admission,params:[lease.jobId,tenant,lease.projectId,
  worker,lease.lease.fence,lease.version,lease.attempts,
  lease.requestSha256,dispatch,admission,60000]};
}
async function renew(params){
 const client=await restricted.connect();
 try{
  await client.query("SET ROLE hf_staging_nonce_dispatcher");
  const result=await client.query(
   "SELECT renewed,lease_version,expires_ms FROM "+
   "modo_hyperframes_staging.renew_synthetic_lease_epoch("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,$11::integer)",
   params);
  assert.equal(result.rows.length,1);
  return result.rows[0];
 }finally{client.release();}
}
async function epochs(id){
 return (await root.query(
  "SELECT from_version,to_version,expires_ms FROM "+
  "modo_hyperframes_staging.synthetic_lease_renewal_epochs "+
  "WHERE job_id=$1::uuid ORDER BY to_version",[id])).rows;
}
before(async()=>{
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE="isolated-staging";
 process.env.MODO_HYPERFRAMES_DB_MODE="isolated-staging";
 process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";
 process.env.MODO_HF_MP4_RECEIPT_MODE="synthetic-ci-only";
 root=new Pool({connectionString:url,ssl:false,max:8});
 restricted=new Pool({connectionString:url,ssl:false,max:24});
 assert.equal((await root.query("SELECT current_database() AS name")).rows[0].name,
  "modo_hyperframes_staging");
 queue=new HyperframesStagingPgQueue(root);
});
after(async()=>{await restricted?.end();await root?.end();});

test("atomic renewal increments queue JSON/version/deadline and immutable audit together",async()=>{
 const f=await fixture(),result=await renew(f.params);
 assert.equal(result.renewed,true);
 assert.equal(result.lease_version,f.lease.version+1);
 assert.ok(Number(result.expires_ms)>f.lease.lease.expiresAt);
 const current=await queue.get(f.lease.jobId,tenant);
 assert.equal(current?.status,"running");
 assert.equal(current.version,result.lease_version);
 assert.equal(current.lease.expiresAt,Number(result.expires_ms));
 assert.equal(current.lease.fence,f.lease.lease.fence);
 assert.equal(current.attempts,f.lease.attempts);
 assert.deepEqual((await epochs(f.lease.jobId)).map(x=>[x.from_version,x.to_version]),
  [[f.lease.version,f.lease.version+1]]);
});
test("20 parallel renewers of same version produce exactly ONE success",async()=>{
 const f=await fixture();
 const attempts=await Promise.all(Array.from({length:20},()=>renew(f.params)));
 assert.equal(attempts.filter(x=>x.renewed===true).length,1);
 assert.equal(attempts.filter(x=>x.renewed===false).length,19);
 assert.equal((await epochs(f.lease.jobId)).length,1);
 assert.equal((await renew(f.params)).renewed,false);
});
test("two bounded renewals only; no third, skips or stale versions",async()=>{
 const f=await fixture();
 const one=await renew(f.params);assert.equal(one.renewed,true);
 const skip=await renew([...f.params.slice(0,5),one.lease_version+1,
  ...f.params.slice(6)]);
 assert.equal(skip.renewed,false);
 const two=await renew([...f.params.slice(0,5),one.lease_version,
  ...f.params.slice(6)]);
 assert.equal(two.renewed,true);
 const third=await renew([...f.params.slice(0,5),two.lease_version,
  ...f.params.slice(6)]);
 assert.equal(third.renewed,false);
 assert.deepEqual((await epochs(f.lease.jobId)).map(x=>x.to_version),
  [f.lease.version+1,f.lease.version+2]);
});
test("wrong tenant, fence, worker, signed digests or absence of launch deny",async()=>{
 const f=await fixture();
 for(const [index,value] of [[1,"synthetic-other-tenant"],
  [2,randomUUID()],[3,"worker-other"],[4,randomUUID()],
  [7,digest("bad-request")],[8,digest("bad-dispatch")],
  [9,digest("bad-admission")],[10,75000]]){
  const changed=[...f.params];changed[index]=value;
  assert.equal((await renew(changed)).renewed,false,"failed index "+index);
 }
 assert.equal((await epochs(f.lease.jobId)).length,0);
 const absent=await fixture({withLaunch:false});
 assert.equal((await renew(absent.params)).renewed,false);
 assert.equal((await renew(f.params)).renewed,true);
});
test("expired or failed lease cannot renew, and old fence cannot regain authority",async()=>{
 const expired=await fixture();
 const now=Date.now()-1000;
 await root.query("UPDATE modo_hyperframes_staging.render_jobs "+
  "SET lease_expires_ms=$2, document=jsonb_set(document,"+
  "'{lease,expiresAt}',to_jsonb($2::bigint)) "+
  "WHERE job_id=$1::uuid",[expired.lease.jobId,now]);
 assert.equal((await renew(expired.params)).renewed,false);
 const f=await fixture();
 const failed=await queue.fail(f.lease.jobId,tenant,worker,f.lease.lease.fence);
 assert.equal(failed.status,"queued");
 assert.equal((await renew(f.params)).renewed,false);
 const reClaim=await queue.claim(f.lease.jobId,tenant,worker,60000);
 assert.notEqual(reClaim.lease.fence,f.lease.lease.fence);
 assert.equal((await renew(f.params)).renewed,false);
});
test("old v2 receipt fails after version increment; v3 receipt acceptance is blocked",async()=>{
 const f=await fixture(),base=f.lease;
 const keys=generateKeyPairSync("ed25519");
 const receiptKeyId="renewal-attestor-ci-v2";
 const observed={outputSha256:digest("real-synthetic-mp4-only"),
  outputBytes:8000,codec:"h264",width:1080,height:1920,fps:30,frames:150};
 const expected={organizationId:tenant,projectId:base.projectId,
  jobId:base.jobId,workerId:worker,leaseFence:base.lease.fence,
  leaseVersion:base.version,attempts:base.attempts,
  requestSha256:base.requestSha256,keyId:receiptKeyId,
  leaseOrderSha256:f.dispatch,rendererJobId:"synthetic-"+randomUUID(),
  rendererOrderSha256:digest("renderer-order")};
 const payload={...expected,version:2,audience:"modo-hf-mp4-receipt-synthetic-v2",
  issuer:"synthetic-trusted-mp4-attestor",...observed,issuedAtMs:Date.now()};
 const envelope=signSyntheticMp4LeaseReceipt(payload,keys.privateKey);
 assert.equal((await renew(f.params)).renewed,true);
 const current=await queue.get(base.jobId,tenant);
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({
  envelope,expected,currentJob:current,observed,
  publicKeys:{[receiptKeyId]:keys.publicKey},nowMs:Date.now()
 }),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 const client=await restricted.connect();
 try{
  await client.query("SET ROLE hf_staging_nonce_dispatcher");
  await assert.rejects(client.query(
   "SELECT modo_hyperframes_staging.commit_synthetic_mp4_receipt("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,"+
   "$11::text,$12::integer) AS recorded",
   [base.jobId,tenant,base.projectId,worker,base.lease.fence,current.version,
    base.attempts,base.requestSha256,f.dispatch,digest("receipt"),
    observed.outputSha256,observed.outputBytes]),
   /HF_SYNTHETIC_RENEWAL_RECEIPT_V3_REQUIRED/);
 }finally{client.release();}
});
test("NOLOGIN dispatcher has renewal EXECUTE only; old worker cannot renew or mutate epochs",async()=>{
 const result=await root.query(
  "SELECT rolcanlogin,rolsuper,"+
  "has_function_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.renew_synthetic_lease_epoch(uuid,text,text,text,uuid,integer,smallint,text,text,text,integer)','EXECUTE') AS can_renew,"+
  "has_function_privilege('hf_staging_worker',"+
  "'modo_hyperframes_staging.renew_synthetic_lease_epoch(uuid,text,text,text,uuid,integer,smallint,text,text,text,integer)','EXECUTE') AS old_worker_renew,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.synthetic_lease_renewal_epochs','INSERT') AS direct_insert,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.render_jobs','UPDATE') AS queue_update "+
  "FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'");
 assert.deepEqual(result.rows,[{rolcanlogin:false,rolsuper:false,
  can_renew:true,old_worker_renew:false,direct_insert:false,queue_update:false}]);
});
