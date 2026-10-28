import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {randomUUID,generateKeyPairSync,createHash} from "node:crypto";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {signSyntheticLeaseOrder,acceptSyntheticLeaseOrder} from "./static-handoff-lease-v2.mjs";
import {createSyntheticLeasePgClaim} from "./static-handoff-pg-lease.mjs";

const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!DB_URL)throw Error("HF_SYNTHETIC_LEASE_CI_DB_REQUIRED");
process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";
const {Pool}=pg,keys=generateKeyPairSync("ed25519");
const sha=s=>createHash("sha256").update(s).digest("hex");
const TENANT="synthetic-tenant-lease-ci",KEY_ID="scheduler-ci-v2",WORKER="worker-ci-one";
let pool,queue;
const source=async()=>{
 const intent={organizationId:TENANT,projectId:randomUUID(),
  idempotencyKey:"synthetic-"+randomUUID(),
  requestSha256:sha("synthetic-input-"+randomUUID())};
 const job=await queue.enqueue(intent,TENANT);
 const running=await queue.claim(job.jobId,TENANT,WORKER,60000);
 assert.equal(running?.status,"running");
 assert.ok(running?.lease?.fence);
 return running;
};
const expected=job=>({
 organizationId:job.organizationId,projectId:job.projectId,
 jobId:job.jobId,workerId:job.lease.workerId,
 leaseFence:job.lease.fence,leaseVersion:job.version,
 attempts:job.attempts,requestSha256:job.requestSha256,keyId:KEY_ID
});
const order=job=>{
 const now=Date.now();
 return {version:2,audience:"modo-hf-lease-synthetic-v2",
 issuer:"synthetic-modo-scheduler",...expected(job),
 nonce:randomUUID(),issuedAtMs:now-1000,expiresAtMs:now+30000};
};
const run=(job,p=order(job),settings={})=>{
 const trusted=expected(job);
 return acceptSyntheticLeaseOrder({
  envelope:signSyntheticLeaseOrder(p,keys.privateKey),
  publicKeys:{[KEY_ID]:keys.publicKey},expected:trusted,nowMs:Date.now(),
  claimLease:createSyntheticLeasePgClaim(pool,trusted),...settings
 });
};
before(async()=>{
 pool=new Pool({connectionString:DB_URL,ssl:false,max:12});
 assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
 "modo_hyperframes_staging");
 queue=new HyperframesStagingPgQueue(pool);
});
after(async()=>await pool?.end());

test("signed lease-bound nonce persists and cannot dispatch twice on same lease",async()=>{
 const j=await source(),p=order(j);
 assert.equal((await run(j,p)).payload.leaseFence,j.lease.fence);
 await assert.rejects(run(j,p),/HF_SYNTHETIC_LEASE_DENIED/);
 await assert.rejects(run(j,{...p,nonce:randomUUID()}),/HF_SYNTHETIC_LEASE_DENIED/);
 const q=await pool.query(
 "SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_lease_handoffs WHERE job_id=$1::uuid",
 [j.jobId]);
 assert.equal(q.rows[0].n,1);
});
test("20 distinct signed orders racing for one actual queue lease yield one winner",async()=>{
 const j=await source(),p=order(j);
 const outcomes=await Promise.allSettled(
 Array.from({length:20},()=>run(j,{...p,nonce:randomUUID()})));
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(outcomes.filter(x=>x.status==="rejected").length,19);
});
test("lease failure and re-claim invalidate old signed order even for same worker",async()=>{
 const first=await source(),old=order(first);
 const failed=await queue.fail(first.jobId,TENANT,WORKER,first.lease.fence);
 assert.equal(failed?.status,"queued");
 const newer=await queue.claim(first.jobId,TENANT,WORKER,60000);
 assert.notEqual(newer.lease.fence,first.lease.fence);
 await assert.rejects(run(first,old),/HF_SYNTHETIC_LEASE_DENIED/);
 assert.equal((await run(newer)).payload.leaseFence,newer.lease.fence);
});
test("finished lease cannot dispatch a previously signed order",async()=>{
 const j=await source(),old=order(j);
 const done=await queue.finish(j.jobId,TENANT,WORKER,j.lease.fence,
  {storageKey:randomUUID(),sha256:sha("synthetic-artifact"),bytes:5000});
 assert.equal(done?.status,"succeeded");
 await assert.rejects(run(j,old),/HF_SYNTHETIC_LEASE_DENIED/);
});
test("Ed25519 signature, tenant, job, project, worker, fence, version and digest enforced",async()=>{
 const j=await source(),p=order(j),original=signSyntheticLeaseOrder(p,keys.privateKey);
 const first=original.signatureB64[0];
 await assert.rejects(run(j,p,{envelope:{...original,
  signatureB64:(first==="A"?"B":"A")+original.signatureB64.slice(1)}}),
  /HF_SYNTHETIC_LEASE_DENIED/);
 await assert.rejects(run(j,p,{revokedKeyIds:[KEY_ID]}),/HF_SYNTHETIC_LEASE_DENIED/);
 await assert.rejects(run(j,p,{publicKeys:{}}),/HF_SYNTHETIC_LEASE_DENIED/);
 for(const [field,value] of [
  ["organizationId","synthetic-other-tenant"],["projectId",randomUUID()],
  ["jobId",randomUUID()],["workerId","worker-other"],["leaseFence",randomUUID()],
  ["leaseVersion",j.version+1],["attempts",j.attempts+1],
  ["requestSha256",sha("wrong")]
 ]){
  await assert.rejects(run(j,{...p,[field]:value}),/HF_SYNTHETIC_LEASE_DENIED/);
 }
 assert.equal((await run(j,p)).payload.jobId,j.jobId);
});
test("both envelope and database clocks reject stale or future requests",async()=>{
 const j=await source(),p=order(j),t=Date.now();
 await assert.rejects(run(j,{...p,issuedAtMs:t-45000,expiresAtMs:t-1}),
  /HF_SYNTHETIC_LEASE_DENIED/);
 await assert.rejects(run(j,{...p,issuedAtMs:t+8000,expiresAtMs:t+18000}),
  /HF_SYNTHETIC_LEASE_DENIED/);
 const claim=createSyntheticLeasePgClaim(pool,expected(j));
 assert.equal(await claim({...p,expiresAtMs:t-1000},sha("test-stale")),false);
 assert.equal(await claim({...p,expiresAtMs:t+100000},sha("test-future")),false);
});
test("wrong database, production gate and stale lease are denied",async()=>{
 const j=await source(),p=order(j),url=new URL(DB_URL);
 url.pathname="/postgres";
 const wrong=new Pool({connectionString:url.toString(),ssl:false,max:1});
 try{
  await assert.rejects(run(j,p,{
   claimLease:createSyntheticLeasePgClaim(wrong,expected(j))}),
   /HF_SYNTHETIC_LEASE_DB_DENIED/);
 }finally{await wrong.end();}
 const prev=process.env.MODO_HF_HANDOFF_MODE,old=process.env.NODE_ENV;
 try{
  delete process.env.MODO_HF_HANDOFF_MODE;
  await assert.rejects(async()=>run(j,p),/HF_SYNTHETIC_LEASE_DENIED/);
  process.env.MODO_HF_HANDOFF_MODE=prev;
  process.env.NODE_ENV="production";
  await assert.rejects(async()=>run(j,p),/HF_SYNTHETIC_LEASE_DENIED/);
 }finally{
  process.env.MODO_HF_HANDOFF_MODE=prev;
  if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;
 }
 await queue.fail(j.jobId,TENANT,WORKER,j.lease.fence);
 await assert.rejects(run(j,p),/HF_SYNTHETIC_LEASE_DENIED/);
});
test("separate NOLOGIN dispatcher has INSERT only; existing worker cannot dispatch",async()=>{
 const r=await pool.query(
  "SELECT rolcanlogin,rolsuper,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',$1,'INSERT') AS dispatcher_insert,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',$2,'UPDATE') AS queue_update,"+
  "has_table_privilege('hf_staging_worker',$1,'INSERT') AS worker_insert,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',$1,'DELETE') AS dispatcher_delete "+
  "FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'",
  ["modo_hyperframes_staging.synthetic_lease_handoffs",
   "modo_hyperframes_staging.render_jobs"]);
 assert.deepEqual(r.rows,[{rolcanlogin:false,rolsuper:false,
 dispatcher_insert:true,queue_update:false,worker_insert:false,dispatcher_delete:false}]);
});

test("the separate NOLOGIN dispatcher can claim through delegated role but cannot modify the queue",async()=>{
 const j=await source(),p=order(j);
 const restricted=new Pool({connectionString:DB_URL,ssl:false,max:1});
 try{
  const client=await restricted.connect();
  try{await client.query("SET ROLE hf_staging_nonce_dispatcher");}
  finally{client.release();}
  const claim=createSyntheticLeasePgClaim(restricted,expected(j));
  assert.equal((await run(j,p,{claimLease:claim})).payload.nonce,p.nonce);
  await assert.rejects(
   restricted.query("UPDATE modo_hyperframes_staging.render_jobs SET status='queued' WHERE job_id=$1::uuid",[j.jobId]),
   /permission denied/
  );
 }finally{await restricted.end();}
});
