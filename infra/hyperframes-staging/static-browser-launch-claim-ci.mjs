/**
 * Disposable CI trusted launcher: must run AFTER scheduler preflight and
 * BEFORE Docker is spawned. Only one of 20 competing launch attempts wins.
 * Direct container re-execution with stolen mounts remains a known limitation.
 */
import {createHash,randomUUID} from "node:crypto";
import {readFile,lstat,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import {createSyntheticBrowserLaunchGate} from "./static-browser-launch-gate.mjs";
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(process.argv.length!==3||!process.argv[2].startsWith("/")||!DB_URL||
 process.env.NODE_ENV==="production"||
 process.env.MODO_HF_BROWSER_LAUNCH_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_PREFLIGHT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
 process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")
 throw Error("HF_SYNTHETIC_BROWSER_LAUNCH_CI_DISABLED");
const dir=resolve(process.argv[2]),digest=b=>createHash("sha256").update(b).digest("hex");
const {Pool}=pg;
const pool=new Pool({connectionString:DB_URL,ssl:false,max:15});
const scoped={
 connect:async()=>{
  const client=await pool.connect();
  try{await client.query("SET ROLE hf_staging_nonce_dispatcher");}
  catch(e){client.release();throw e;}
  return client;
 }
};
try{
 assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name,
  "modo_hyperframes_staging");
 for(const name of ["order.json","admission.json","admission-public-key.pem","preflight-meta.json"]){
  const st=await lstat(join(dir,name));
  assert.equal(st.isFile(),true);
  assert.equal(st.isSymbolicLink(),false);
  assert.ok(st.size>=32&&st.size<16000);
 }
 const rendererOrderBytes=await readFile(join(dir,"order.json"));
 const original=JSON.parse(rendererOrderBytes.toString("utf8"));
 const rendererPayload=JSON.parse(Buffer.from(original.payloadB64,"base64url").toString("utf8"));
 const envelope=JSON.parse(await readFile(join(dir,"admission.json"),"utf8"));
 const publicKey=await readFile(join(dir,"admission-public-key.pem"));
 const expected=JSON.parse(await readFile(join(dir,"preflight-meta.json"),"utf8"));
 const gate=createSyntheticBrowserLaunchGate(scoped,expected);
 const params={envelope,publicKey,rendererOrderBytes,rendererPayload};
 // Wrong signed metadata, signature and request hashes fail before database.
 await assert.rejects(gate({...params,rendererOrderBytes:Buffer.from("modified")}),
  /HF_STATIC_RENDERER_ADMISSION_DENIED/);
 const bad={...expected,admissionSha256:digest("wrong")};
 await assert.rejects(createSyntheticBrowserLaunchGate(scoped,bad)(params),
  /HF_SYNTHETIC_BROWSER_LAUNCH_DENIED/);
 const sig=envelope.signatureB64;
 await assert.rejects(gate({...params,envelope:{...envelope,
  signatureB64:(sig[0]==="A"?"B":"A")+sig.slice(1)}}),
  /HF_STATIC_RENDERER_ADMISSION_DENIED/);
 const outcomes=await Promise.allSettled(Array.from({length:20},()=>gate(params)));
 assert.equal(outcomes.filter(x=>x.status==="fulfilled"&&x.value===true).length,1);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled"&&x.value===false).length,19);
 assert.equal(outcomes.filter(x=>x.status==="rejected").length,0);
 assert.equal(await gate(params),false);
 const j=expected.expectedLease;
 const found=await pool.query(
  "SELECT nonce,admission_sha256,renderer_order_sha256,dispatch_sha256 "+
  "FROM modo_hyperframes_staging.synthetic_browser_launches "+
  "WHERE job_id=$1::uuid AND lease_fence=$2::uuid",
  [j.jobId,j.leaseFence]
 );
 assert.equal(found.rowCount,1);
 assert.equal(found.rows[0].admission_sha256.trim(),expected.admissionSha256);
 assert.equal(found.rows[0].renderer_order_sha256.trim(),expected.rendererOrderSha256);
 assert.equal(found.rows[0].dispatch_sha256.trim(),expected.leaseOrderSha256);
 const check=await pool.query(
  "SELECT rolcanlogin,has_function_privilege("+
  "'hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.consume_synthetic_browser_launch(uuid,uuid,text,text,text,uuid,integer,smallint,text,text,text,text,bigint)',"+
  "'EXECUTE') AS can_launch,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.synthetic_browser_launches','INSERT') AS can_insert,"+
  "has_table_privilege('hf_staging_worker',"+
  "'modo_hyperframes_staging.synthetic_browser_launches','INSERT') AS worker_insert "+
  "FROM pg_roles WHERE rolname='hf_staging_nonce_dispatcher'");
 assert.equal(check.rows[0].rolcanlogin,false);
 assert.equal(check.rows[0].can_launch,true);
 assert.equal(check.rows[0].can_insert,false);
 assert.equal(check.rows[0].worker_insert,false);
 const c=await scoped.connect();
 try{
  await assert.rejects(c.query(
   "UPDATE modo_hyperframes_staging.render_jobs SET status='queued' "+
   "WHERE job_id=$1::uuid",[j.jobId]),/permission denied/);
 }finally{c.release();}
 // Marker is trusted-host only, never mounted into Chrome; CI requires it.
 await writeFile(join(dir,"launch-confirmation.json"),
  JSON.stringify({syntheticOnly:true,oneShotClaimed:true,jobId:j.jobId,
   leaseFence:j.leaseFence,nonce:found.rows[0].nonce,
   admissionSha256:expected.admissionSha256}),{flag:"wx",mode:0o600});
 process.stdout.write(JSON.stringify({trustedLaunchClaim:true,syntheticOnly:true,
  exactlyOneWinnerOf20:true,noBrowserDb:true,noProduction:true})+"\n");
}finally{await pool.end();}
