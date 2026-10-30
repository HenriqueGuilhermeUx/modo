/**
 * Trusted HOST lease supervisor (synthetic CI only).
 *
 * One event-triggered renewal while the one-shot Chrome process is alive.
 * Chrome receives no DB credentials, signing key, or lease authority.
 * A stopped/missing renderer MUST NOT cause a host-side renewal.
 */
import {readFile,lstat} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve,join} from "node:path";
import pg from "pg";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
const {Pool}=pg;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const FAIL=()=>{throw Error("HF_SYNTHETIC_LIVE_HOST_RENEWAL_DENIED");};
const allowed=()=>process.env.NODE_ENV!=="production"&&
 process.env.MODO_HF_LIVE_RENEWAL_MODE==="synthetic-ci-only"&&
 process.env.MODO_HYPERFRAMES_DB_MODE==="isolated-staging"&&
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE==="isolated-staging"&&
 process.env.MODO_HF_BROWSER_LAUNCH_MODE==="synthetic-ci-only";
const check=x=>x&&typeof x==="object"&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x)&&x>0;
export async function renewLiveSyntheticLeaseFromPg({pool,expectedLease,
 dispatchSha256,admissionSha256,durationMs=60000}){
 if(!allowed()||typeof pool?.connect!=="function"||!check(expectedLease)||
  expectedLease.organizationId!=="synthetic-tenant-mp4-receipt"||
  !UUID.test(expectedLease.jobId)||!UUID.test(expectedLease.projectId)||
  !UUID.test(expectedLease.leaseFence)||
  !/^[a-z][a-z0-9-]{3,50}$/.test(expectedLease.workerId)||
  !integer(expectedLease.leaseVersion)||
  !integer(expectedLease.attempts)||expectedLease.attempts>3||
  !HEX.test(expectedLease.requestSha256)||
  !HEX.test(dispatchSha256)||!HEX.test(admissionSha256)||
  !integer(durationMs)||durationMs>60000)FAIL();
 const client=await pool.connect();let open=false;
 try{
  await client.query("BEGIN");open=true;
  await client.query("SET LOCAL ROLE hf_staging_nonce_dispatcher");
  const {rows}=await client.query(
   "SELECT current_database() AS database_name,"+
   " x.renewed,x.lease_version,x.expires_ms FROM "+
   "modo_hyperframes_staging.renew_synthetic_lease_epoch("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,$6::integer,"+
   "$7::smallint,$8::text,$9::text,$10::text,$11::integer) x",
   [expectedLease.jobId,expectedLease.organizationId,
    expectedLease.projectId,expectedLease.workerId,
    expectedLease.leaseFence,expectedLease.leaseVersion,expectedLease.attempts,
    expectedLease.requestSha256,dispatchSha256,admissionSha256,durationMs]);
  if(rows.length!==1||rows[0].database_name!=="modo_hyperframes_staging"||
   rows[0].renewed!==true||
   rows[0].lease_version!==expectedLease.leaseVersion+1||
   !integer(Number(rows[0].expires_ms)))FAIL();
  await client.query("COMMIT");open=false;
  return {leaseVersion:rows[0].lease_version,
   expiresAtMs:Number(rows[0].expires_ms),epoch:1};
 }finally{
  if(open)await client.query("ROLLBACK").catch(()=>{});
  client.release();
 }
}
const execute=promisify(execFile);
/**
 * The renderer's 0700 output directory MUST remain owned by UID 10001.
 * On EACCES, let the trusted GitHub HOST use a bounded, noninteractive root
 * stat of this one fixed MP4 path. Never chmod/chown the active render mount.
 * Only confirmed ENOENT is treated as absent; all other sudo errors deny.
 */
async function outputAlreadyExists(file){
 try{await lstat(file);return true;}
 catch(e){
  if(e?.code==="ENOENT")return false;
  if(e?.code!=="EACCES")FAIL();
  try{
   await execute("/usr/bin/sudo",["-n","/usr/bin/stat","-c","%F",file],{
    timeout:3000,maxBuffer:2048,env:{...process.env,LC_ALL:"C"}});
   return true;
  }catch(err){
   if(err?.code===1 && /No such file or directory/.test(err?.stderr||""))
    return false;
   FAIL();
  }
 }
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function safeFile(p){
 try{
  const st=await lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>16000)FAIL();
  return JSON.parse(await readFile(p,"utf8"));
 }catch(e){
  if(e?.code==="ENOENT")return null;
  throw e;
 }
}
function alive(pid){
 try{process.kill(pid,0);return true;}catch{return false;}
}
export async function superviseSyntheticRendererLiveLease({
 pool,inputDir,outputDir,renderPid,timeoutMs=20000,pollMs=100,
 renderAlive=alive
}){
 if(!allowed()||!check(pool)||!integer(renderPid)||
  !integer(timeoutMs)||timeoutMs>30000||
  !integer(pollMs)||pollMs>500||typeof renderAlive!=="function"||
  typeof inputDir!=="string"||typeof outputDir!=="string"||
  !inputDir.startsWith("/")||!outputDir.startsWith("/"))FAIL();
 const metadata=await safeFile(join(inputDir,"preflight-meta.json"));
 if(!check(metadata)||!check(metadata.expectedLease)||!HEX.test(metadata.leaseOrderSha256)||
  !HEX.test(metadata.admissionSha256))FAIL();
 const {expectedLease}=metadata;
 const queue=new HyperframesStagingPgQueue(pool);
 // Probe live queue BEFORE any renewal. Never trust renderer-controlled data
 // or a copied launch-confirmation file alone.
 const q=await queue.get(expectedLease.jobId,expectedLease.organizationId);
 if(q?.status!=="running"||q.version!==expectedLease.leaseVersion||
  q.lease?.fence!==expectedLease.leaseFence||
  q.lease?.workerId!==expectedLease.workerId||
  q.projectId!==expectedLease.projectId||
  q.requestSha256!==expectedLease.requestSha256)FAIL();
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  if(!renderAlive(renderPid))FAIL();
  const launched=await safeFile(join(inputDir,"launch-confirmation.json"));
  if(launched){
   if(launched.syntheticOnly!==true||launched.oneShotClaimed!==true||
    launched.jobId!==expectedLease.jobId||
    launched.leaseFence!==expectedLease.leaseFence||
    launched.admissionSha256!==metadata.admissionSha256||
    await outputAlreadyExists(join(outputDir,"synthetic.mp4")))FAIL();
   // The renewal SQL independently enforces one-shot browser launch,
   // pre-existing handoff digest, live job row and <=120s total horizon.
   const value=await renewLiveSyntheticLeaseFromPg({
    pool,expectedLease,dispatchSha256:metadata.leaseOrderSha256,
    admissionSha256:metadata.admissionSha256,durationMs:60000});
   if(!renderAlive(renderPid))FAIL();
   const latest=await queue.get(expectedLease.jobId,expectedLease.organizationId);
   if(latest?.status!=="running"||latest.version!==value.leaseVersion||
    latest.lease?.fence!==expectedLease.leaseFence||
    latest.lease?.expiresAt!==value.expiresAtMs)FAIL();
   return {...value,renewedWhileRendererAlive:true,
    noPublication:true,syntheticOnly:true};
  }
  await wait(pollMs);
 }
 FAIL();
}
if(process.argv[1]&&import.meta.url===new URL("file://"+resolve(process.argv[1])).href){
 if(!allowed()||process.argv.length!==5||
  !process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL)FAIL();
 const dir=resolve(process.argv[2]),out=resolve(process.argv[3]),
  renderPid=Number(process.argv[4]);
 const pool=new Pool({connectionString:process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL,
  ssl:false,max:3});
 try{
  const result=await superviseSyntheticRendererLiveLease({
   pool,inputDir:dir,outputDir:out,renderPid});
  process.stdout.write(JSON.stringify(result)+"\n");
 }finally{await pool.end();}
}
