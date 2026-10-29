/**
 * CI-only offline receipt proof for a real FFmpeg H.264 MP4 rendered in the
 * independent Chrome image. The browser process never receives keys or DB.
 * The preflight scheduler claims DB lease and signs a browser admission BEFORE rendering.
 */
import {createHash,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,verify as edVerify} from "node:crypto";
import {readFile,lstat,writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {HyperframesStagingPgArtifacts} from "../../apps/api/src/services/hyperframes-staging-pg-artifacts.ts";
import {signSyntheticLeaseOrder,acceptSyntheticLeaseOrder} from "./static-handoff-lease-v2.mjs";
import {createSyntheticLeasePgClaim} from "./static-handoff-pg-lease.mjs";
import {signSyntheticMp4LeaseReceipt,verifySyntheticMp4LeaseReceipt} from "./static-lease-mp4-receipt-v2.mjs";
import admissionVerifier from "./static-renderer-admission.cjs";
import {commitVerifiedSyntheticMp4Receipt} from "./static-synthetic-mp4-pg-receipt-ledger.mjs";
const {verifySyntheticRendererAdmission}=admissionVerifier;

const EXEC=promisify(execFile);
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(process.env.NODE_ENV==="production"||
 process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
 process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE!=="isolated-staging"||
 !DB_URL||process.argv.length!==4||
 !process.argv[2].startsWith("/")||!process.argv[3].startsWith("/")) {
 throw Error("HF_SYNTHETIC_REAL_MP4_E2E_DISABLED");
}
const inputDir=resolve(process.argv[2]),outputDir=resolve(process.argv[3]);
const videoPath=join(outputDir,"synthetic.mp4");
const digest=x=>createHash("sha256").update(x).digest("hex");
const {Pool}=pg;
const pool=new Pool({connectionString:DB_URL,ssl:false,max:6});
let passed=false;
try {
 const db=await pool.query("SELECT current_database() AS name");
 assert.equal(db.rows[0].name,"modo_hyperframes_staging");
 const stat=await lstat(videoPath);
 assert.equal(stat.isFile(),true);
 assert.equal(stat.isSymbolicLink(),false);
 assert.ok(stat.size>=4000&&stat.size<=25000000);
 const video=await readFile(videoPath);
 assert.equal(video.length,stat.size);
 assert.equal(video.toString("ascii",4,8),"ftyp");
 const outputSha256=digest(video);
 const {stdout}=await EXEC("/usr/bin/ffprobe",[
  "-v","error","-show_entries",
  "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration",
  "-of","json",videoPath
 ],{timeout:12000,maxBuffer:8192});
 const probe=JSON.parse(stdout);
 const stream=probe.streams?.[0];
 assert.equal(probe.streams?.length,1);
 assert.equal(stream.codec_type,"video");
 assert.equal(stream.codec_name,"h264");
 assert.equal(stream.width,1080);
 assert.equal(stream.height,1920);
 assert.equal(stream.r_frame_rate,"30/1");
 assert.equal(Number(stream.nb_frames),150);
 assert.ok(Math.abs(Number(probe.format?.duration)-5)<0.05);
 // Verify true temporal progression INSIDE each scene, not merely that
 // each of three static scene boundaries differs. FFmpeg decodes raw frames;
 // scene-local pixel changes cannot be spoofed by MP4 timestamps alone.
 const temporalFrameSets=[[0,15,30],[31,63,94],[95,122,149]];
 const temporalFrames=temporalFrameSets.flat();
 const temporalSelect=temporalFrames.map(n=>"eq(n\\,"+n+")").join("+");
 const {stdout:temporalMd5}=await EXEC("/usr/bin/ffmpeg",[
  "-hide_banner","-loglevel","error","-nostdin","-i",videoPath,
  "-vf","select="+temporalSelect,"-vsync","0","-f","framemd5","-"
 ],{timeout:20000,maxBuffer:24000});
 const temporalRows=temporalMd5.split("\n").map(x=>x.trim())
  .filter(x=>x&&!x.startsWith("#")).map(x=>x.split(",").map(z=>z.trim()));
 assert.equal(temporalRows.length,9,"HF_TEMPORAL_NINE_DECODED_FRAMES_REQUIRED");
 for(let i=0;i<temporalFrames.length;i++){
  assert.equal(Number(temporalRows[i][1]),temporalFrames[i],
   "HF_TEMPORAL_FRAME_INDEX_MISMATCH");
  assert.match(temporalRows[i].at(-1),/^[0-9a-f]{32}$/);
 }
 for(let i=0;i<3;i++){
  const hashes=temporalRows.slice(i*3,i*3+3).map(x=>x.at(-1));
  assert.ok(new Set(hashes).size>=2,
   "HF_TEMPORAL_SCENE_HAS_NO_INTRA_SCENE_MOTION_"+(i+1));
 }
 const observed={outputSha256,outputBytes:video.length,codec:"h264",
  width:1080,height:1920,fps:30,frames:150};
 // Verify the ORIGINAL signer (which has no private key on disk) independently
 // of the renderer's own signature verification.
 const orderBytes=await readFile(join(inputDir,"order.json"));
 const order=JSON.parse(orderBytes.toString("utf8"));
 assert.deepEqual(Object.keys(order).sort(),["payloadB64","signatureB64"]);
 const signedBytes=Buffer.from(order.payloadB64,"base64url");
 const signature=Buffer.from(order.signatureB64,"base64url");
 assert.equal(signedBytes.toString("base64url"),order.payloadB64);
 assert.equal(signature.length,64);
 const key=createPublicKey(await readFile(join(inputDir,"public-key.pem")));
 assert.equal(key.asymmetricKeyType,"ed25519");
 assert.equal(edVerify(null,signedBytes,key,signature),true);
 const source=JSON.parse(signedBytes.toString("utf8"));
 assert.equal(JSON.stringify(source),signedBytes.toString("utf8"));
 assert.equal(source.audience,"modo-static-renderer-synthetic-ci-v1");
 assert.equal(source.totalFrames,150);
 assert.equal(source.width,observed.width);
 assert.equal(source.height,observed.height);
 assert.equal(source.fps,observed.fps);
 assert.match(source.jobId,/^synthetic-[a-z0-9-]{10,70}$/);
 const rendererOrderSha256=digest(orderBytes);
 const requestSha256=digest(signedBytes);
 // Scheduler preflight has ALREADY authorized and claimed this lease
 // BEFORE the Docker renderer started. Read both current DB and signed permit.
 const preflight=JSON.parse(await readFile(join(inputDir,"preflight-meta.json"),"utf8"));
 const permit=JSON.parse(await readFile(join(inputDir,"admission.json"),"utf8"));
 const permitKey=await readFile(join(inputDir,"admission-public-key.pem"));
 const authorized=verifySyntheticRendererAdmission(permit,permitKey,orderBytes,source);
 const permitBytes=Buffer.from(permit.payloadB64,"base64url");
 assert.equal(digest(permitBytes),preflight.admissionSha256);
 assert.equal(authorized.jobId,preflight.expectedLease.jobId);
 assert.equal(authorized.leaseFence,preflight.expectedLease.leaseFence);
 assert.equal(authorized.requestSha256,requestSha256);
 assert.equal(preflight.rendererOrderSha256,rendererOrderSha256);
 assert.equal(preflight.rendererJobId,source.jobId);
 const launchMarker=JSON.parse(await readFile(join(inputDir,"launch-confirmation.json"),"utf8"));
 assert.equal(launchMarker.oneShotClaimed,true);
 assert.equal(launchMarker.syntheticOnly,true);
 assert.equal(launchMarker.admissionSha256,preflight.admissionSha256);
 const expectedLease=preflight.expectedLease;
 assert.equal(launchMarker.jobId,expectedLease.jobId);
 assert.equal(launchMarker.leaseFence,expectedLease.leaseFence);
 const {organizationId:tenant,projectId,jobId:authorizedJob,workerId}=expectedLease;
 const queue=new HyperframesStagingPgQueue(pool);
 const lease=await queue.get(authorizedJob,tenant);
 assert.equal(lease?.status,"running");
 assert.equal(lease?.lease?.fence,authorized.leaseFence);
 assert.equal(lease?.requestSha256,requestSha256);
 assert.equal(lease?.organizationId,tenant);
 assert.equal(lease?.projectId,projectId);
 assert.equal(lease?.version,expectedLease.leaseVersion);
 assert.equal(lease?.attempts,expectedLease.attempts);
 assert.ok(lease.lease.expiresAt>Date.now());
 const claim=await pool.query(
  "SELECT signed_order_sha256 FROM modo_hyperframes_staging.synthetic_lease_handoffs "+
  "WHERE job_id=$1::uuid AND organization_id=$2 AND lease_fence=$3::uuid",
  [authorizedJob,tenant,lease.lease.fence]
 );
 assert.equal(claim.rowCount,1);
 assert.equal(claim.rows[0].signed_order_sha256.trim(),preflight.leaseOrderSha256);
 const launches=await pool.query(
  "SELECT admission_sha256,renderer_order_sha256,dispatch_sha256 "+
  "FROM modo_hyperframes_staging.synthetic_browser_launches "+
  "WHERE job_id=$1::uuid AND lease_fence=$2::uuid",
  [authorizedJob,lease.lease.fence]
 );
 assert.equal(launches.rowCount,1);
 assert.equal(launches.rows[0].admission_sha256.trim(),preflight.admissionSha256);
 assert.equal(launches.rows[0].renderer_order_sha256.trim(),rendererOrderSha256);
 assert.equal(launches.rows[0].dispatch_sha256.trim(),preflight.leaseOrderSha256);
 const accepted={signedRequestSha256:preflight.leaseOrderSha256};
 const receiptKeys=generateKeyPairSync("ed25519");
 const receiptKeyId="trusted-attestor-ci-v2";
 const receipt={
  version:2,audience:"modo-hf-mp4-receipt-synthetic-v2",
  issuer:"synthetic-trusted-mp4-attestor",
  keyId:receiptKeyId,
  organizationId:tenant,projectId,jobId:lease.jobId,workerId,
  leaseFence:lease.lease.fence,leaseVersion:lease.version,
  attempts:lease.attempts,requestSha256,
  leaseOrderSha256:accepted.signedRequestSha256,
  rendererJobId:source.jobId,rendererOrderSha256,
  ...observed,issuedAtMs:Date.now()
 };
 const envelope=signSyntheticMp4LeaseReceipt(receipt,receiptKeys.privateKey);
 const expected={...expectedLease,keyId:receiptKeyId,
  leaseOrderSha256:accepted.signedRequestSha256,
  rendererJobId:source.jobId,rendererOrderSha256};
 const readQueue=await queue.get(lease.jobId,tenant);
 const verifyOptions={envelope,
  publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  expected,currentJob:readQueue,observed,nowMs:Date.now()};
 const valid=verifySyntheticMp4LeaseReceipt(verifyOptions);
 assert.equal(valid.verifiedMp4Sha256,outputSha256);
 const badSha={...observed,outputSha256:digest("tampered synthetic bytes")};
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({...verifyOptions,observed:badSha}),
  /HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({...verifyOptions,
  expected:{...expected,leaseFence:randomUUID()}}),
  /HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({...verifyOptions,
  revokedKeyIds:[receiptKeyId]}),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 const sig=envelope.signatureB64;
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({...verifyOptions,
  envelope:{...envelope,signatureB64:(sig[0]==="A"?"B":"A")+sig.slice(1)}}),
  /HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 // Preserve a public-only receipt and key on the disposable runner, not in
 // Docker and never in a production service. Read back to prove portability.
 await writeFile(join(outputDir,"receipt.json"),JSON.stringify(envelope),
  {encoding:"utf8",flag:"wx",mode:0o600});
 await writeFile(join(outputDir,"receipt-public-key.pem"),
  receiptKeys.publicKey.export({format:"pem",type:"spki"}),
  {flag:"wx",mode:0o600});
 const diskEnvelope=JSON.parse(await readFile(join(outputDir,"receipt.json"),"utf8"));
 const diskPublic=createPublicKey(await readFile(join(outputDir,"receipt-public-key.pem")));
 assert.equal(verifySyntheticMp4LeaseReceipt({...verifyOptions,
  envelope:diskEnvelope,publicKeys:{[receiptKeyId]:diskPublic}}).receiptSha256,
  valid.receiptSha256);
 // The signed receipt is ONLY committed as proof metadata after the real MP4
 // was measured and the queue fence was verified. The database rechecks the
 // live lock atomically. No final MP4 storage or published/succeeded flag.
 const restricted=new Pool({connectionString:DB_URL,ssl:false,max:1});
 try{
  const client=await restricted.connect();
  try{await client.query("SET ROLE hf_staging_nonce_dispatcher");}
  finally{client.release();}
  const ack=await commitVerifiedSyntheticMp4Receipt({
   pool:restricted,...verifyOptions
  });
  assert.equal(ack.recorded,true);
  assert.equal(ack.receiptSha256,valid.receiptSha256);
  const duplicate=await commitVerifiedSyntheticMp4Receipt({
   pool:restricted,...verifyOptions
  });
  assert.equal(duplicate.recorded,false);
  await assert.rejects(commitVerifiedSyntheticMp4Receipt({
   pool:restricted,...verifyOptions,observed:badSha
  }),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
  await assert.rejects(commitVerifiedSyntheticMp4Receipt({
   pool:restricted,...verifyOptions,revokedKeyIds:[receiptKeyId]
  }),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
  await assert.rejects(restricted.query(
   "UPDATE modo_hyperframes_staging.render_jobs SET status='queued' WHERE job_id=$1::uuid",
   [lease.jobId]
  ),/permission denied/);
 }finally{await restricted.end();}
 const receiptLedger=await pool.query(
  "SELECT receipt_sha256,output_sha256,output_bytes "+
  "FROM modo_hyperframes_staging.synthetic_receipt_attestations "+
  "WHERE job_id=$1::uuid AND lease_fence=$2::uuid",
  [lease.jobId,lease.lease.fence]
 );
 assert.equal(receiptLedger.rowCount,1);
 assert.equal(receiptLedger.rows[0].receipt_sha256.trim(),valid.receiptSha256);
 assert.equal(receiptLedger.rows[0].output_sha256.trim(),outputSha256);
 assert.equal(receiptLedger.rows[0].output_bytes,video.length);
 assert.equal((await queue.get(lease.jobId,tenant)).status,"running");
 // Reuse the EXISTING staging AES-256-GCM vault. Its encrypted ciphertext
 // INSERT and terminal job update already occur in ONE PG transaction. A
 // database AFTER INSERT trigger on this synthetic tenant requires the
 // signed attestation, validates the live fence/digest/bytes, and inserts the
 // finalization proof within that same transaction (or all roll back).
 const keyBytes=randomBytes(32);
 const vault=new HyperframesStagingPgArtifacts(pool,{
  key:keyBytes,retentionMs:300000,maxTotalBytes:50000000
 });
 try{
  // No receipt: the encrypted artifact and terminal transition MUST both roll back.
  const withoutReceipt=await queue.enqueue({
   organizationId:tenant,projectId:randomUUID(),
   requestSha256:digest("synthetic-no-receipt-"+randomUUID()),
   idempotencyKey:"synthetic-no-receipt-"+randomUUID()
  },tenant);
  const withoutLease=await queue.claim(withoutReceipt.jobId,tenant,workerId,60000);
  assert.equal(withoutLease?.status,"running");
  await assert.rejects(vault.finishWithVideo({
   jobId:withoutReceipt.jobId,authorizedOrganizationId:tenant,
   workerId,fence:withoutLease.lease.fence,video
  }),/HF_SYNTHETIC_LAUNCH_FINALIZATION_NOT_CLAIMED/);
  assert.equal((await queue.get(withoutReceipt.jobId,tenant)).status,"running");
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
   [withoutReceipt.jobId])).rows[0].n,0);
  await queue.fail(withoutReceipt.jobId,tenant,workerId,withoutLease.lease.fence);
  const invalid=Buffer.from(video);
  invalid[invalid.length-1]^=1; // keeps ftyp but changes SHA-256
  await assert.rejects(vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video:invalid
  }),/HF_SYNTHETIC_(?:ENCRYPTED_FINALIZATION_MISSING_RECEIPT|LAUNCH_FINALIZATION_NOT_CLAIMED)/);
  assert.equal((await queue.get(lease.jobId,tenant)).status,"running");
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
   [lease.jobId])).rows[0].n,0);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM modo_hyperframes_staging.synthetic_encrypted_finalizations WHERE job_id=$1::uuid",
   [lease.jobId])).rows[0].n,0);
  // A forged caller cannot overwrite the existing lease or tenant.
  assert.equal(await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:randomUUID(),video
  }),null);
  assert.equal(await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:"synthetic-other-tenant",
   workerId,fence:lease.lease.fence,video
  }),null);
  const finished=await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video
  });
  assert.equal(finished?.status,"succeeded");
  assert.equal(finished?.previewOnly,true);
  assert.equal(finished?.published,false);
  assert.equal(finished?.artifact?.sha256,outputSha256);
  assert.equal(finished?.artifact?.bytes,video.length);
  const artifact=await pool.query(
   "SELECT storage_key,ciphertext,iv,auth_tag,sha256,byte_length "+
   "FROM modo_hyperframes_staging.render_artifacts WHERE job_id=$1::uuid",
   [lease.jobId]
  );
  assert.equal(artifact.rowCount,1);
  assert.equal(artifact.rows[0].sha256.trim(),outputSha256);
  assert.equal(artifact.rows[0].byte_length,video.length);
  assert.equal(artifact.rows[0].ciphertext.equals(video),false);
  assert.equal(artifact.rows[0].iv.length,12);
  assert.equal(artifact.rows[0].auth_tag.length,16);
  const finalization=await pool.query(
   "SELECT receipt_sha256,output_sha256,output_bytes,storage_key,lease_fence "+
   "FROM modo_hyperframes_staging.synthetic_encrypted_finalizations "+
   "WHERE job_id=$1::uuid",
   [lease.jobId]
  );
  assert.equal(finalization.rowCount,1);
  assert.equal(finalization.rows[0].receipt_sha256.trim(),valid.receiptSha256);
  assert.equal(finalization.rows[0].output_sha256.trim(),outputSha256);
  assert.equal(finalization.rows[0].output_bytes,video.length);
  assert.equal(finalization.rows[0].storage_key,artifact.rows[0].storage_key);
  assert.equal(finalization.rows[0].lease_fence,lease.lease.fence);
  const restarted=new HyperframesStagingPgArtifacts(pool,{key:keyBytes});
  try{
   const recovered=await restarted.read(lease.jobId,tenant);
   assert.deepEqual(recovered,video);
   recovered?.fill(0);
   assert.equal(await restarted.read(lease.jobId,"synthetic-other-tenant"),null);
   const duplicate=await restarted.finishWithVideo({
    jobId:lease.jobId,authorizedOrganizationId:tenant,
    workerId,fence:lease.lease.fence,video
   });
   assert.equal(duplicate,null);
  }finally{restarted.close();}
  const invalidKey=new HyperframesStagingPgArtifacts(pool,{key:randomBytes(32)});
  try{
   await assert.rejects(invalidKey.read(lease.jobId,tenant),/INTEGRITY_FAILED/);
  }finally{invalidKey.close();}
 }finally{vault.close();keyBytes.fill(0);}
 // Terminal job cannot be failed/reclaimed or used to authorize a new receipt.
 assert.equal(await queue.fail(lease.jobId,tenant,workerId,lease.lease.fence),null);
 const terminalJob=await queue.get(lease.jobId,tenant);
 assert.equal(terminalJob?.status,"succeeded");
 await assert.rejects(commitVerifiedSyntheticMp4Receipt({
  pool,...verifyOptions,currentJob:terminalJob
 }),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 assert.throws(()=>verifySyntheticMp4LeaseReceipt({
  ...verifyOptions,currentJob:terminalJob
 }),/HF_SYNTHETIC_MP4_RECEIPT_DENIED/);
 const q=await pool.query(
  "SELECT count(*)::int AS total FROM modo_hyperframes_staging.synthetic_lease_handoffs WHERE job_id=$1::uuid",
  [lease.jobId]);
 assert.equal(q.rows[0].total,1);
 passed=true;
 process.stdout.write(JSON.stringify({
  passed:true,syntheticOnly:true,realMp4:true,
  frames:observed.frames,codec:observed.codec,
  outputBytes:observed.outputBytes,mp4Sha256:outputSha256,
  signedReceiptSha256:valid.receiptSha256,
  verifiedLeaseFence:true,authorizedBeforeRender:true,oneShotLaunchClaim:true,temporalMotionVerified:true,temporalFramesSampled:9,receiptLedgerAtomic:true,encryptedVideoAtomic:true,verifiedAfterRestart:true,rejectedTamper:true,rejectedStaleFence:true,
  noPublication:true,noSecretsInRenderer:true
 })+"\n");
}finally{
 await pool.end();
 if(!passed)process.stderr.write("HF_SYNTHETIC_REAL_MP4_RECEIPT_E2E_FAILED\n");
}
