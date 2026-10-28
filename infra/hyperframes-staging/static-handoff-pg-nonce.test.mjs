import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {generateKeyPairSync,randomUUID} from "node:crypto";
import {createSyntheticPgNonceConsumer} from "./static-handoff-pg-nonce.mjs";
import {acceptSyntheticHandoff,signSyntheticHandoff,sha256} from "./static-handoff-contract.mjs";
const URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!URL)throw Error("HF_SYNTHETIC_NONCE_TEST_REQUIRES_STAGING_DB");
process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";
process.env.MODO_HYPERFRAMES_DB_MODE="isolated-staging";
const {Pool}=pg,keys=generateKeyPairSync("ed25519"),hash=s=>sha256(Buffer.from(s));
let pool;
const identity=()=>({tenantId:"synthetic-tenant-pg",jobId:"synthetic-job-pg-nonce",workerId:"worker-ci-one",keyId:"scheduler-ci-v1",orderSha256:hash("render-order")});
const order=()=>{const x=identity(),now=Date.now();return {
 version:1,audience:"modo-hf-handoff-synthetic-v1",issuer:"synthetic-modo-scheduler",
 keyId:x.keyId,tenantId:x.tenantId,projectId:"synthetic-project-pg",jobId:x.jobId,
 workerId:x.workerId,projectSha256:hash("project"),orderSha256:x.orderSha256,
 nonce:randomUUID(),issuedAtMs:now-1000,expiresAtMs:now+45000};};
const consumer=(p,x=identity())=>createSyntheticPgNonceConsumer(p,x);
const opt=(x,consumeNonce,identityOverride=identity())=>({
 envelope:signSyntheticHandoff(x,keys.privateKey),
 publicKeys:{"scheduler-ci-v1":keys.publicKey},
 expected:{...identityOverride,projectId:x.projectId,projectSha256:x.projectSha256},
 nowMs:Date.now(),consumeNonce
});
before(async()=>{
 pool=new Pool({connectionString:URL,ssl:false,max:12});
 const q=await pool.query("SELECT current_database() AS name");
 assert.equal(q.rows[0].name,"modo_hyperframes_staging");
});
after(async()=>{await pool?.end();});
test("durable replay is rejected after new Pool/client",async()=>{
 const x=order(),first=opt(x,consumer(pool));
 await acceptSyntheticHandoff(first);
 const another=new Pool({connectionString:URL,ssl:false,max:2});
 try{await assert.rejects(acceptSyntheticHandoff({...first,consumeNonce:consumer(another)}),/HANDOFF_DENIED/);}
 finally{await another.end();}
 const q=await pool.query("SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_handoff_nonces WHERE nonce=$1::uuid",[x.nonce]);
 assert.equal(q.rows[0].n,1);
});
test("exactly one accepted of 20 concurrent signed requests",async()=>{
 const x=order(),o=opt(x,consumer(pool));
 const outcomes=await Promise.allSettled(Array.from({length:20},()=>acceptSyntheticHandoff(o)));
 assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(outcomes.filter(r=>r.status==="rejected").length,19);
});
test("global nonce denies reuse even across independently signed synthetic tenants",async()=>{
 const x=order();await acceptSyntheticHandoff(opt(x,consumer(pool)));
 const y={...x,tenantId:"synthetic-tenant-two"};
 const yi={...identity(),tenantId:y.tenantId};
 await assert.rejects(acceptSyntheticHandoff(opt(y,consumer(pool,yi),yi)),/HANDOFF_DENIED/);
});
test("PostgreSQL clock rejects expired and excessive future expiry",async()=>{
 const c=consumer(pool),x=order();
 assert.equal(await c(x.tenantId,randomUUID(),Date.now()-1000),false);
 assert.equal(await c(x.tenantId,randomUUID(),Date.now()+120000),false);
 await assert.rejects(c("synthetic-wrong-tenant",randomUUID(),Date.now()+30000),/NONCE_DENIED/);
});
test("gate refuses production and disabled database mode",async()=>{
 const x=order(),c=consumer(pool),oldMode=process.env.MODO_HYPERFRAMES_DB_MODE,oldNode=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV="production";await assert.rejects(c(x.tenantId,x.nonce,x.expiresAtMs),/NONCE_DENIED/);
  process.env.NODE_ENV="test";delete process.env.MODO_HYPERFRAMES_DB_MODE;
  await assert.rejects(c(x.tenantId,x.nonce,x.expiresAtMs),/NONCE_DENIED/);
 }finally{
  if(oldNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNode;
  process.env.MODO_HYPERFRAMES_DB_MODE=oldMode;
 }
});
test("wrong database name fails before insert",async()=>{
 const url=new URL(URL);url.pathname="/postgres";
 const wrong=new Pool({connectionString:url.toString(),ssl:false,max:1}),x=order();
 try{await assert.rejects(consumer(wrong)(x.tenantId,x.nonce,x.expiresAtMs),/NONCE_DENIED/);}
 finally{await wrong.end();}
});
test("nonce dispatcher role is no-login insert-only; legacy worker cannot insert",async()=>{
 const q=await pool.query(
 "SELECT rolcanlogin,rolsuper,"+
 "has_table_privilege('hf_staging_nonce_dispatcher',$1,'INSERT') AS can_insert,"+
 "has_table_privilege('hf_staging_nonce_dispatcher',$1,'SELECT') AS can_read,"+
 "has_table_privilege('hf_staging_worker',$1,'INSERT') AS worker_can_insert,"+
 "has_schema_privilege('hf_staging_nonce_dispatcher','modo_hyperframes_staging','CREATE') AS can_create "+
 "FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'",
 ["modo_hyperframes_staging.synthetic_handoff_nonces"]);
 assert.deepEqual(q.rows,[{rolcanlogin:false,rolsuper:false,can_insert:true,can_read:false,worker_can_insert:false,can_create:false}]);
});
