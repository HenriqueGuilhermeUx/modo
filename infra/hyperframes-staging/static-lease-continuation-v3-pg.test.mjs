/**
 * Live disposable PostgreSQL proof for migration 011.
 * Never reads customer data or writes signed MP4 receipts.
 */
import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,createHash} from "node:crypto";
import pg from "pg";
import {HyperframesStagingPgArtifacts} from "../../apps/api/src/services/hyperframes-staging-pg-artifacts.ts";
import {HyperframesStagingPgQueue} from
 "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {issueSyntheticLeaseContinuationV3FromPg,
 verifySyntheticLeaseContinuationV3AgainstPg}
 from "./static-lease-continuation-v3-pg.mjs";
import {signSyntheticMp4OutputReceiptV3,verifySyntheticMp4OutputReceiptV3}
 from "./static-lease-mp4-receipt-v3.mjs";
import {commitVerifiedSyntheticMp4OutputV3}
 from "./static-synthetic-mp4-pg-receipt-ledger-v3.mjs";
const url=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(!url)throw Error("HF_SYNTHETIC_V3_PG_TEST_DB_REQUIRED");
const {Pool}=pg,tenant="synthetic-tenant-mp4-receipt",worker="worker-ci-one";
const keys=generateKeyPairSync("ed25519"),keyId="trusted-renewal-v3-ci";
const sha=x=>createHash("sha256").update(x).digest("hex");
let pool,queue;
before(async()=>{
 process.env.MODO_HF_CONTINUATION_V3_MODE="synthetic-ci-only";
 process.env.MODO_HYPERFRAMES_DB_MODE="isolated-staging";
 process.env.MODO_HYPERFRAMES_STORAGE_MODE="isolated-staging";
 process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE="synthetic-ci-only";
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

const receiptKeys=generateKeyPairSync("ed25519"),receiptKeyId="trusted-renewed-mp4-v3-ci";
async function createOutputV3(f,video=null){
 const continuation=await issued(f);
 const {rows}=await pool.query("SELECT "+
  "modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot("+
  "$1::uuid,$2::text,$3::uuid) AS snapshot",
  [f.lease.jobId,tenant,f.lease.lease.fence]);
 const context=rows[0]?.snapshot;
 assert.ok(context,"live locked continuation snapshot missing");
 const c=JSON.parse(Buffer.from(continuation.envelope.payloadB64,"base64url").toString("utf8"));
 const observed={outputSha256:video?sha(video):sha("synthetic-test-only-mp4-"+randomUUID()),
  outputBytes:video?video.length:46049,codec:"h264",width:1080,height:1920,fps:30,frames:150};
 const payload={version:3,audience:"modo-hf-mp4-output-renewed-synthetic-v3",
  issuer:"trusted-synthetic-renewed-mp4-attestor",keyId:receiptKeyId,
  organizationId:c.organizationId,projectId:c.projectId,jobId:c.jobId,
  workerId:c.workerId,leaseFence:c.leaseFence,
  leaseVersion:c.leaseVersion,attempts:c.attempts,
  requestSha256:c.requestSha256,dispatchSha256:c.dispatchSha256,
  admissionSha256:c.admissionSha256,
  continuationSha256:continuation.verified.continuationSha256,epoch:c.epoch,
  rendererJobId:"synthetic-"+randomUUID(),
  rendererOrderSha256:context.launch.rendererOrderSha256,
  ...observed,issuedAtMs:context.nowMs};
 const options={continuationEnvelope:continuation.envelope,
  continuationPublicKeys:{[keyId]:keys.publicKey},
  context,observed,nowMs:context.nowMs};
 const envelope=signSyntheticMp4OutputReceiptV3({
  payload,privateKey:receiptKeys.privateKey,...options});
 const v=verifySyntheticMp4OutputReceiptV3({
  envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},...options});
 assert.equal(v.continuationSha256,continuation.verified.continuationSha256);
 return {envelope,observed,options,continuation,payload};
}
function commitOutput(f,out){
 return commitVerifiedSyntheticMp4OutputV3({
  ...args(f),envelope:out.envelope,observed:out.observed,
  publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  continuationEnvelope:out.continuation.envelope,
  continuationPublicKeys:{[keyId]:keys.publicKey}
 });
}
test("v3 MP4 proof requires a real prior renewal; signed output after a live epoch is acknowledged once",async()=>{
 const f=await fixture();
 await assert.rejects(createOutputV3(f),/HF_SYNTHETIC_V3_DB_ATTESTATION_DENIED/);
 assert.equal((await renew(f.params)).renewed,true);
 const out=await createOutputV3(f);
 const first=await commitOutput(f,out);
 assert.equal(first.recorded,true);
 assert.equal(first.storageAllowed,false);
 assert.equal(first.publicationAllowed,false);
 assert.equal(first.epoch,1);
 const duplicate=await commitOutput(f,out);
 assert.equal(duplicate.recorded,false,"one receipt per job/fence");
 const {rows}=await pool.query(
  "SELECT receipt_sha256,epoch,lease_version,output_sha256,output_bytes "+
  "FROM modo_hyperframes_staging.synthetic_mp4_output_receipts_v3 "+
  "WHERE job_id=$1::uuid",[f.lease.jobId]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].receipt_sha256.trim(),first.receiptSha256);
 assert.equal(rows[0].output_sha256.trim(),out.observed.outputSha256);
 assert.equal(rows[0].epoch,1);
 assert.equal((await pool.query("SELECT count(*)::int AS n "+
  "FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
  [f.lease.jobId])).rows[0].n,0);
 // Once v3 output is attested, no new epoch may be appended.
 const next=[...f.params];next[5]=first.epoch+f.lease.version;
 await assert.rejects(renew(next),/HF_SYNTHETIC_V3_OUTPUT_ALREADY_ATTESTED/);
 assert.equal((await queue.get(f.lease.jobId,tenant)).version,
  first.epoch+f.lease.version);
});
test("second renewed epoch invalidates prior v3 MP4 receipt and only latest can be acknowledged",async()=>{
 const f=await fixture();const one=await renew(f.params);
 assert.equal(one.renewed,true);
 const old=await createOutputV3(f);
 const args2=[...f.params];args2[5]=one.lease_version;
 const two=await renew(args2);assert.equal(two.renewed,true);
 await assert.rejects(commitOutput(f,old),/HF_SYNTHETIC_LEASE_CONTINUATION_V3_DENIED/);
 const fresh=await createOutputV3(f);
 const ack=await commitOutput(f,fresh);
 assert.equal(ack.recorded,true);assert.equal(ack.epoch,2);
 assert.equal((await commitOutput(f,fresh)).recorded,false);
});
test("MP4 output Ed25519 signature tamper, wrong measured hash and wrong Chrome order deny",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const out=await createOutputV3(f);
 const s=out.envelope.signatureB64;
 const forged={...out.envelope,signatureB64:(s[0]==="A"?"B":"A")+s.slice(1)};
 await assert.rejects(commitVerifiedSyntheticMp4OutputV3({
  ...args(f),envelope:forged,observed:out.observed,
  publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  continuationEnvelope:out.continuation.envelope,
  continuationPublicKeys:{[keyId]:keys.publicKey}
 }),/HF_SYNTHETIC_MP4_RECEIPT_V3_DENIED/);
 assert.throws(()=>verifySyntheticMp4OutputReceiptV3({
  envelope:out.envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  ...out.options,observed:{...out.observed,outputSha256:sha("tamper")}
 }),/HF_SYNTHETIC_MP4_RECEIPT_V3_DENIED/);
 const bad={...out.payload,rendererOrderSha256:sha("not-rendered-by-chrome")};
 assert.throws(()=>signSyntheticMp4OutputReceiptV3({
  payload:bad,privateKey:receiptKeys.privateKey,...out.options
 }),/HF_SYNTHETIC_MP4_RECEIPT_V3_DENIED/);
 assert.throws(()=>verifySyntheticMp4OutputReceiptV3({
  envelope:out.envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  revokedKeyIds:[receiptKeyId],...out.options
 }),/HF_SYNTHETIC_MP4_RECEIPT_V3_DENIED/);
 assert.equal((await commitOutput(f,out)).recorded,true);
});
test("concurrent v3 MP4 output receipts compete on one job and one is committed",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const out=await createOutputV3(f);
 const rows=await Promise.all(Array.from({length:12},()=>commitOutput(f,out)));
 assert.equal(rows.filter(x=>x.recorded).length,1);
 assert.equal(rows.filter(x=>!x.recorded).length,11);
});
test("old legacy v2 ledger and encrypted artifact remain barred after renewed v3 proof",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const out=await createOutputV3(f);
 assert.equal((await commitOutput(f,out)).recorded,true);
 const {rows}=await pool.query(
  "SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_receipt_attestations "+
  "WHERE job_id=$1::uuid",[f.lease.jobId]);
 assert.equal(rows[0].n,0);
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE hf_staging_nonce_dispatcher");
  await assert.rejects(client.query("SELECT "+
   "modo_hyperframes_staging.commit_synthetic_mp4_receipt("+
   "$1::uuid,$2::text,$3::text,$4::text,$5::uuid,"+
   "$6::integer,$7::smallint,$8::text,$9::text,$10::text,"+
   "$11::text,$12::integer)",
   [f.lease.jobId,tenant,f.lease.projectId,worker,f.lease.lease.fence,
    f.lease.version+1,f.lease.attempts,f.lease.requestSha256,
    f.params[8],sha("legacy-v2-receipt"),out.observed.outputSha256,
    out.observed.outputBytes]),/HF_SYNTHETIC_RENEWAL_RECEIPT_V3_REQUIRED/);
  await client.query("ROLLBACK");
 }finally{client.release();}
});
test("old worker cannot write v3 receipt ledger and dispatcher has no direct insert",async()=>{
 const {rows}=await pool.query(
  "SELECT has_function_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.commit_synthetic_mp4_output_v3("+
  "uuid,text,text,text,uuid,integer,smallint,text,text,text,smallint,text,text,text,integer)',"+
  "'EXECUTE') AS dispatcher_execute,"+
  "has_function_privilege('hf_staging_worker',"+
  "'modo_hyperframes_staging.commit_synthetic_mp4_output_v3("+
  "uuid,text,text,text,uuid,integer,smallint,text,text,text,smallint,text,text,text,integer)',"+
  "'EXECUTE') AS worker_execute,"+
  "has_table_privilege('hf_staging_nonce_dispatcher',"+
  "'modo_hyperframes_staging.synthetic_mp4_output_receipts_v3','INSERT') AS dispatcher_insert");
 assert.deepEqual(rows,[{dispatcher_execute:true,worker_execute:false,
  dispatcher_insert:false}]);
});

function syntheticCiphertextFixture(){
 // Deliberately not a real MP4: this proves AES-GCM/receipt atomicity in PG;
 // a later E2E must prove the real FFprobe-validated MP4 after renewal.
 const video=Buffer.alloc(46_049,37);
 video.write("ftyp",4,"ascii");
 return video;
}
test("V3 encrypted AES-GCM finalization is disabled without explicit synthetic-only opt-in",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const video=syntheticCiphertextFixture(),o=await createOutputV3(f,video);
 const ack=await commitOutput(f,o);assert.equal(ack.recorded,true);
 const vault=new HyperframesStagingPgArtifacts(pool,{key:Buffer.alloc(32,23),retentionMs:300000,maxTotalBytes:50000000});
 try{
  const before=process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE;
  delete process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE;
  await assert.rejects(vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,workerId:worker,
   fence:f.lease.lease.fence,video,v3ReceiptSha256:ack.receiptSha256
  }),/HF_SYNTHETIC_V3_ENCRYPTED_FINALIZATION_DISABLED/);
  if(before!==undefined)process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE=before;
  else process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE="synthetic-ci-only";
  assert.equal((await queue.get(f.lease.jobId,tenant)).status,"running");
 }finally{vault.close();}
});
test("AES-GCM vault + renewed v3 receipt/fence/epoch commit atomically, decrypts after restart",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const video=syntheticCiphertextFixture();
 const o=await createOutputV3(f,video);
 const ack=await commitOutput(f,o);assert.equal(ack.recorded,true);
 const key=Buffer.alloc(32,29);
 const vault=new HyperframesStagingPgArtifacts(pool,{
  key,retentionMs:300000,maxTotalBytes:50000000});
 try{
  // No V3 marker: the original V2 triggers must still reject this job.
  await assert.rejects(vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,
   workerId:worker,fence:f.lease.lease.fence,video
  }),/HF_SYNTHETIC_(?:LAUNCH_FINALIZATION_NOT_CLAIMED|ENCRYPTED_FINALIZATION_MISSING_RECEIPT)/);
  // A mismatched, otherwise valid MP4-shaped buffer cannot pass digest gate.
  const changed=Buffer.from(video);changed[changed.length-1]^=1;
  await assert.rejects(vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,
   workerId:worker,fence:f.lease.lease.fence,video:changed,
   v3ReceiptSha256:ack.receiptSha256
  }),/HF_SYNTHETIC_V3_ENCRYPTED_PROOF_MISMATCH/);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM "+
   "modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
   [f.lease.jobId])).rows[0].n,0);
  assert.equal((await queue.get(f.lease.jobId,tenant)).status,"running");
  assert.equal(await vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,
   workerId:worker,fence:randomUUID(),video,
   v3ReceiptSha256:ack.receiptSha256
  }),null);
  const finished=await vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,
   workerId:worker,fence:f.lease.lease.fence,video,
   v3ReceiptSha256:ack.receiptSha256
  });
  assert.equal(finished.status,"succeeded");
  assert.equal(finished.published,false);
  assert.equal(finished.previewOnly,true);
  assert.deepEqual(await vault.read(f.lease.jobId,tenant),video);
  assert.equal(await vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,workerId:worker,
   fence:f.lease.lease.fence,video,v3ReceiptSha256:ack.receiptSha256
  }),null);
  const {rows}=await pool.query(
   "SELECT r.receipt_sha256,r.output_sha256,r.output_bytes,r.lease_version,r.epoch,"+
   " a.v3_receipt_sha256,a.ciphertext,a.iv,a.auth_tag "+
   "FROM modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3 r "+
   "JOIN modo_hyperframes_staging.render_artifacts a ON a.job_id=r.job_id "+
   "WHERE r.job_id=$1::uuid",[f.lease.jobId]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].receipt_sha256.trim(),ack.receiptSha256);
  assert.equal(rows[0].v3_receipt_sha256.trim(),ack.receiptSha256);
  assert.equal(rows[0].output_sha256.trim(),sha(video));
  assert.equal(rows[0].output_bytes,video.length);
  assert.equal(rows[0].lease_version,f.lease.version+1);
  assert.equal(rows[0].epoch,1);
  assert.equal(rows[0].ciphertext.equals(video),false);
  assert.equal(rows[0].iv.length,12);
  assert.equal(rows[0].auth_tag.length,16);
  assert.equal((await pool.query("SELECT count(*)::integer AS n "+
   "FROM modo_hyperframes_staging.synthetic_encrypted_finalizations "+
   "WHERE job_id=$1::uuid",[f.lease.jobId])).rows[0].n,0);
  vault.close();
  const restarted=new HyperframesStagingPgArtifacts(pool,{
   key,retentionMs:300000,maxTotalBytes:50000000});
  try{
   assert.deepEqual(await restarted.read(f.lease.jobId,tenant),video);
   assert.equal(await restarted.read(f.lease.jobId,"synthetic-other-tenant"),null);
  }finally{restarted.close();}
 }finally{vault.close();}
});
test("expired or wrong-fence signed v3 output can never become encrypted artifact",async()=>{
 const f=await fixture();assert.equal((await renew(f.params)).renewed,true);
 const video=syntheticCiphertextFixture();
 const output=await createOutputV3(f,video);
 const ack=await commitOutput(f,output);assert.equal(ack.recorded,true);
 const vault=new HyperframesStagingPgArtifacts(pool,{
  key:Buffer.alloc(32,31),retentionMs:300000,maxTotalBytes:50000000});
 try{
  assert.equal(await vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,workerId:worker,
   fence:randomUUID(),video,v3ReceiptSha256:ack.receiptSha256
  }),null);
  const expiry=Date.now()-1000;
  await pool.query("UPDATE modo_hyperframes_staging.render_jobs "+
   "SET lease_expires_ms=$2,document=jsonb_set(document,"+
   "'{lease,expiresAt}',to_jsonb($2::bigint)) "+
   "WHERE job_id=$1::uuid",[f.lease.jobId,expiry]);
  assert.equal(await vault.finishWithVideo({
   jobId:f.lease.jobId,authorizedOrganizationId:tenant,workerId:worker,
   fence:f.lease.lease.fence,video,v3ReceiptSha256:ack.receiptSha256
  }),null);
  assert.equal((await pool.query("SELECT count(*)::integer AS n "+
   "FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
   [f.lease.jobId])).rows[0].n,0);
 }finally{vault.close();}
});
