import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomUUID,sign} from "node:crypto";
import pg from "pg";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {signSyntheticLeaseOrder,acceptSyntheticLeaseOrder} from "./static-handoff-lease-v2.mjs";
import {createSyntheticLeasePgClaim} from "./static-handoff-pg-lease.mjs";
import {createSyntheticBrowserLaunchGate} from "./static-browser-launch-gate.mjs";
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!DB_URL)throw Error("HF_SYNTHETIC_LAUNCH_TEST_DATABASE_REQUIRED");
const {Pool}=pg,hash=b=>createHash("sha256").update(b).digest("hex");
const tenant="synthetic-tenant-mp4-receipt";
const worker="worker-ci-one";
const schedulerKeyId="scheduler-ci-v2";
const admitKeyId="trusted-scheduler-admission-ci";
const scheduler=generateKeyPairSync("ed25519");
const key=generateKeyPairSync("ed25519");
let pool,queue;
const protectedPool={
 connect:async()=>{
  const c=await pool.connect();
  try{await c.query("SET ROLE hf_staging_nonce_dispatcher");}
  catch(e){c.release();throw e;}
  return c;
 }
};
async function fixture(){
 const orderPayload={version:1,jobId:"synthetic-"+randomUUID(),
  purpose:"render-independent-synthetic-test",padding:"A".repeat(160)};
 const orderBytes=Buffer.from(JSON.stringify(orderPayload));
 const job=await queue.enqueue({
  organizationId:tenant,projectId:randomUUID(),
  idempotencyKey:"launch-"+randomUUID(),requestSha256:hash(orderBytes)
 },tenant);
 const lease=await queue.claim(job.jobId,tenant,worker,60000);
 assert.equal(lease?.status,"running");
 const expectedLease={
  keyId:schedulerKeyId,organizationId:tenant,projectId:lease.projectId,
  jobId:lease.jobId,workerId:worker,leaseFence:lease.lease.fence,
  leaseVersion:lease.version,attempts:lease.attempts,requestSha256:lease.requestSha256
 };
 const now=Date.now(),expiry=Math.min(now+30000,lease.lease.expiresAt-1000);
 const dispatch={
  version:2,audience:"modo-hf-lease-synthetic-v2",
  issuer:"synthetic-modo-scheduler",...expectedLease,
  nonce:randomUUID(),issuedAtMs:now-1000,expiresAtMs:expiry
 };
 const claimed=await acceptSyntheticLeaseOrder({
  envelope:signSyntheticLeaseOrder(dispatch,scheduler.privateKey),
  publicKeys:{[schedulerKeyId]:scheduler.publicKey},
  expected:expectedLease,nowMs:Date.now(),
  claimLease:createSyntheticLeasePgClaim(pool,expectedLease)
 });
 const admission={
  version:3,audience:"modo-static-render-admission-synthetic-v3",
  issuer:"synthetic-trusted-scheduler",keyId:admitKeyId,
  organizationId:tenant,projectId:lease.projectId,jobId:lease.jobId,
  workerId:worker,leaseFence:lease.lease.fence,leaseVersion:lease.version,
  attempts:lease.attempts,requestSha256:lease.requestSha256,
  leaseOrderSha256:claimed.signedRequestSha256,
  rendererJobId:orderPayload.jobId,rendererOrderSha256:hash(orderBytes),
  nonce:randomUUID(),issuedAtMs:Date.now()-300,expiresAtMs:expiry
 };
 const bytes=Buffer.from(JSON.stringify(admission));
 const envelope={payloadB64:bytes.toString("base64url"),
  signatureB64:sign(null,bytes,key.privateKey).toString("base64url")};
 const params={envelope,publicKey:key.publicKey,
  rendererOrderBytes:orderBytes,rendererPayload:orderPayload};
 const expected={expectedLease,admissionSha256:hash(bytes),
  rendererJobId:orderPayload.jobId,rendererOrderSha256:hash(orderBytes),
  leaseOrderSha256:claimed.signedRequestSha256};
 return {lease,expected,params,admission,gate:createSyntheticBrowserLaunchGate(protectedPool,expected)};
}
before(async()=>{
 process.env.MODO_HF_BROWSER_LAUNCH_MODE="synthetic-ci-only";
 process.env.MODO_HF_PREFLIGHT_MODE="synthetic-ci-only";
 process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";
 process.env.MODO_HYPERFRAMES_DB_MODE="isolated-staging";
 pool=new Pool({connectionString:DB_URL,ssl:false,max:14});
 assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
  "modo_hyperframes_staging");
 queue=new HyperframesStagingPgQueue(pool);
});
after(async()=>await pool?.end());

test("20 concurrent signed launches of one live fence yield exactly one true",async()=>{
 const f=await fixture();
 const responses=await Promise.all(Array.from({length:20},()=>f.gate(f.params)));
 assert.equal(responses.filter(Boolean).length,1);
 assert.equal(responses.filter(x=>x===false).length,19);
 assert.equal(await f.gate(f.params),false);
 const r=await pool.query(
  "SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_browser_launches WHERE job_id=$1::uuid",
  [f.lease.jobId]);
 assert.equal(r.rows[0].n,1);
});
test("stale lease fence and completed/failed attempt cannot authorize launch",async()=>{
 const f=await fixture();
 const failed=await queue.fail(f.lease.jobId,tenant,worker,f.lease.lease.fence);
 assert.equal(failed.status,"queued");
 assert.equal(await f.gate(f.params),false);
 const newer=await queue.claim(f.lease.jobId,tenant,worker,60000);
 assert.notEqual(newer.lease.fence,f.lease.lease.fence);
 assert.equal(await f.gate(f.params),false);
 const c=await pool.query(
  "SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_browser_launches WHERE job_id=$1::uuid",
  [f.lease.jobId]);
 assert.equal(c.rows[0].n,0);
});
test("tampered signature, identity and original order digest denied before SQL",async()=>{
 const f=await fixture();
 const sig=f.params.envelope.signatureB64;
 await assert.rejects(f.gate({...f.params,envelope:{
  ...f.params.envelope,signatureB64:(sig[0]==="A"?"B":"A")+sig.slice(1)
 }}),/HF_STATIC_RENDERER_ADMISSION_DENIED/);
 await assert.rejects(f.gate({...f.params,
  rendererPayload:{...f.params.rendererPayload,jobId:"synthetic-"+randomUUID()}}),
  /HF_STATIC_RENDERER_ADMISSION_DENIED/);
 await assert.rejects(f.gate({...f.params,rendererOrderBytes:Buffer.from("bad")}),
  /HF_STATIC_RENDERER_ADMISSION_DENIED/);
 const wrong=createSyntheticBrowserLaunchGate(protectedPool,{
  ...f.expected,leaseOrderSha256:hash("other-dispatch")});
 await assert.rejects(wrong(f.params),/HF_SYNTHETIC_BROWSER_LAUNCH_DENIED/);
 assert.equal(await f.gate(f.params),true);
});
test("wrong database and disabled production gates fail closed",async()=>{
 const f=await fixture();
 const url=new URL(DB_URL);url.pathname="/postgres";
 const other=new Pool({connectionString:url.toString(),ssl:false,max:1});
 try{
  const wrong=createSyntheticBrowserLaunchGate(other,f.expected);
  await assert.rejects(wrong(f.params),/HF_SYNTHETIC_BROWSER_LAUNCH_DENIED/);
 }finally{await other.end();}
 const prior=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV="production";
  assert.throws(()=>createSyntheticBrowserLaunchGate(protectedPool,f.expected),
   /HF_SYNTHETIC_BROWSER_LAUNCH_DENIED/);
 }finally{
  if(prior===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=prior;
 }
 assert.equal(await f.gate(f.params),true);
});
test("NOLOGIN dispatcher EXECUTE-only, old browser worker has no launch or queue writes",async()=>{
 const r=await pool.query(
  "SELECT rolcanlogin,rolsuper,"+
  "has_function_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.consume_synthetic_browser_launch(uuid,uuid,text,text,text,uuid,integer,smallint,text,text,text,text,bigint)','EXECUTE') AS execute,"+
  "has_table_privilege('hf_staging_nonce_dispatcher','modo_hyperframes_staging.synthetic_browser_launches','INSERT') AS insert,"+
  "has_function_privilege('hf_staging_worker',"+
  "'modo_hyperframes_staging.consume_synthetic_browser_launch(uuid,uuid,text,text,text,uuid,integer,smallint,text,text,text,text,bigint)','EXECUTE') AS worker_execute "+
  "FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'");
 assert.deepEqual(r.rows,[{rolcanlogin:false,rolsuper:false,
  execute:true,insert:false,worker_execute:false}]);
});
