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
import {issueSyntheticLeaseContinuationV3FromPg,
 verifySyntheticLeaseContinuationV3AgainstPg}
 from "./static-lease-continuation-v3-pg.mjs";
import {signSyntheticMp4OutputReceiptV3,verifySyntheticMp4OutputReceiptV3}
 from "./static-lease-mp4-receipt-v3.mjs";
import {commitVerifiedSyntheticMp4OutputV3}
 from "./static-synthetic-mp4-pg-receipt-ledger-v3.mjs";
const {verifySyntheticRendererAdmission}=admissionVerifier;

const EXEC=promisify(execFile);
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(process.env.NODE_ENV==="production"||
 process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_CONTINUATION_V3_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_RENEWED_V3_FINALIZE_MODE!=="synthetic-ci-only"||
 process.env.MODO_HYPERFRAMES_STORAGE_MODE!=="isolated-staging"||
 process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE!=="isolated-staging"||
 !DB_URL||process.argv.length!==4||
 !process.argv[2].startsWith("/")||!process.argv[3].startsWith("/")) {
 throw Error("HF_SYNTHETIC_RENEWED_REAL_MP4_E2E_DISABLED");
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
 // The trusted HOST supervisor must have renewed THIS job while Chrome
 // remained alive, BEFORE this post-render verification phase starts.
 const renewalProof=JSON.parse(await readFile(join(inputDir,
  "live-renewal-proof.json"),"utf8"));
 assert.equal(renewalProof.renewedWhileRendererAlive,true);
 assert.equal(renewalProof.syntheticOnly,true);
 assert.equal(renewalProof.noPublication,true);
 assert.equal(renewalProof.epoch,1);
 assert.equal(lease?.version,expectedLease.leaseVersion+1);
 assert.equal(lease?.version,renewalProof.leaseVersion);
 assert.equal(lease?.lease?.expiresAt,renewalProof.expiresAtMs);
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

 // No renewal is permitted here. A trusted host-side process must have
 // committed exactly one epoch while Chrome/FFmpeg was STILL RUNNING.
 const evidence=(await pool.query(
  "SELECT from_version,to_version,expires_ms FROM "+
  "modo_hyperframes_staging.synthetic_lease_renewal_epochs "+
  "WHERE job_id=$1::uuid AND lease_fence=$2::uuid",
  [lease.jobId,lease.lease.fence])).rows;
 assert.equal(evidence.length,1);
 assert.equal(evidence[0].from_version,expectedLease.leaseVersion);
 assert.equal(evidence[0].to_version,lease.version);
 assert.equal(Number(evidence[0].expires_ms),renewalProof.expiresAtMs);
 const live=await queue.get(lease.jobId,tenant);
 assert.equal(live.version,expectedLease.leaseVersion+1);
 assert.equal(live.lease.fence,lease.lease.fence);
 assert.equal(live.lease.expiresAt,renewalProof.expiresAtMs);
 const continuationKeys=generateKeyPairSync("ed25519");
 const continuationKeyId="synthetic-renewed-v3-ci";
 const continuation=await issueSyntheticLeaseContinuationV3FromPg({
  pool,jobId:lease.jobId,tenant,leaseFence:lease.lease.fence,
  keyId:continuationKeyId,privateKey:continuationKeys.privateKey,
  publicKey:continuationKeys.publicKey});
 const check=await verifySyntheticLeaseContinuationV3AgainstPg({
  pool,jobId:lease.jobId,tenant,leaseFence:lease.lease.fence,
  envelope:continuation.envelope,
  publicKeys:{[continuationKeyId]:continuationKeys.publicKey}});
 assert.equal(check.continuationSha256,continuation.verified.continuationSha256);
 const snapshot=(await pool.query(
  "SELECT modo_hyperframes_staging.read_synthetic_v3_continuation_snapshot("+
  "$1::uuid,$2::text,$3::uuid) AS snapshot",
  [lease.jobId,tenant,lease.lease.fence])).rows[0]?.snapshot;
 assert.ok(snapshot);
 assert.equal(snapshot.epochs.length,1);
 assert.equal(snapshot.launch.rendererOrderSha256,rendererOrderSha256);
 const c=JSON.parse(Buffer.from(continuation.envelope.payloadB64,"base64url").toString("utf8"));
 const receiptKeys=generateKeyPairSync("ed25519");
 const receiptKeyId="synthetic-output-v3-ci";
 const payload={
  version:3,audience:"modo-hf-mp4-output-renewed-synthetic-v3",
  issuer:"trusted-synthetic-renewed-mp4-attestor",keyId:receiptKeyId,
  organizationId:tenant,projectId,jobId:lease.jobId,workerId,
  leaseFence:lease.lease.fence,leaseVersion:live.version,
  attempts:lease.attempts,requestSha256,dispatchSha256:preflight.leaseOrderSha256,
  admissionSha256:preflight.admissionSha256,
  continuationSha256:continuation.verified.continuationSha256,epoch:1,
  rendererJobId:source.jobId,rendererOrderSha256,...observed,
  issuedAtMs:snapshot.nowMs
 };
 const verifyInputs={
  continuationEnvelope:continuation.envelope,
  continuationPublicKeys:{[continuationKeyId]:continuationKeys.publicKey},
  context:snapshot,observed,nowMs:snapshot.nowMs
 };
 const envelope=signSyntheticMp4OutputReceiptV3({
  payload,privateKey:receiptKeys.privateKey,...verifyInputs});
 const validated=verifySyntheticMp4OutputReceiptV3({
  envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},...verifyInputs});
 assert.equal(validated.observedMp4Sha256,outputSha256);
 const ack=await commitVerifiedSyntheticMp4OutputV3({
  pool,jobId:lease.jobId,tenant,leaseFence:lease.lease.fence,
  envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  continuationEnvelope:continuation.envelope,
  continuationPublicKeys:{[continuationKeyId]:continuationKeys.publicKey},
  observed
 });
 assert.equal(ack.recorded,true);
 assert.equal(ack.storageAllowed,false,"receipt alone is NOT media storage");
 assert.equal((await commitVerifiedSyntheticMp4OutputV3({
  pool,jobId:lease.jobId,tenant,leaseFence:lease.lease.fence,
  envelope,publicKeys:{[receiptKeyId]:receiptKeys.publicKey},
  continuationEnvelope:continuation.envelope,
  continuationPublicKeys:{[continuationKeyId]:continuationKeys.publicKey},
  observed
 })).recorded,false,"v3 output receipt is one-shot");
 const keyBytes=randomBytes(32);
 const vault=new HyperframesStagingPgArtifacts(pool,{
  key:keyBytes,retentionMs:300000,maxTotalBytes:50000000});
 try{
  const forged=Buffer.from(video);forged[forged.length-1]^=1;
  await assert.rejects(vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video:forged,
   v3ReceiptSha256:ack.receiptSha256
  }),/HF_SYNTHETIC_V3_ENCRYPTED_PROOF_MISMATCH/);
  assert.equal((await queue.get(lease.jobId,tenant)).status,"running");
  // The original V2 triggers cannot be bypassed by omitting the V3 marker.
  await assert.rejects(vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video
  }),/HF_SYNTHETIC_(?:LAUNCH_FINALIZATION_NOT_CLAIMED|ENCRYPTED_FINALIZATION_MISSING_RECEIPT)/);
  assert.equal((await pool.query(
   "SELECT count(*)::integer AS n FROM modo_hyperframes_staging.render_artifacts "+
   "WHERE job_id=$1::uuid",[lease.jobId])).rows[0].n,0);
  assert.equal(await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:randomUUID(),video,v3ReceiptSha256:ack.receiptSha256
  }),null);
  const final=await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video,v3ReceiptSha256:ack.receiptSha256
  });
  assert.equal(final?.status,"succeeded");
  assert.equal(final?.previewOnly,true);
  assert.equal(final?.published,false);
  assert.deepEqual(await vault.read(lease.jobId,tenant),video);
  assert.equal(await vault.finishWithVideo({
   jobId:lease.jobId,authorizedOrganizationId:tenant,
   workerId,fence:lease.lease.fence,video,v3ReceiptSha256:ack.receiptSha256
  }),null);
  const finalEvidence=(await pool.query(
   "SELECT r.receipt_sha256,r.epoch,r.lease_version,r.output_sha256,"+
   " a.v3_receipt_sha256,a.iv,a.auth_tag,a.ciphertext "+
   "FROM modo_hyperframes_staging.synthetic_renewed_encrypted_finalizations_v3 r "+
   "JOIN modo_hyperframes_staging.render_artifacts a ON a.job_id=r.job_id "+
   "WHERE r.job_id=$1::uuid",[lease.jobId])).rows;
  assert.equal(finalEvidence.length,1);
  assert.equal(finalEvidence[0].receipt_sha256.trim(),ack.receiptSha256);
  assert.equal(finalEvidence[0].v3_receipt_sha256.trim(),ack.receiptSha256);
  assert.equal(finalEvidence[0].epoch,1);
  assert.equal(finalEvidence[0].lease_version,live.version);
  assert.equal(finalEvidence[0].output_sha256.trim(),outputSha256);
  assert.equal(finalEvidence[0].iv.length,12);
  assert.equal(finalEvidence[0].auth_tag.length,16);
  assert.equal(finalEvidence[0].ciphertext.equals(video),false);
  assert.equal((await pool.query(
   "SELECT count(*)::integer AS n FROM "+
   "modo_hyperframes_staging.synthetic_encrypted_finalizations "+
   "WHERE job_id=$1::uuid",[lease.jobId])).rows[0].n,0);
  vault.close();
  const restarted=new HyperframesStagingPgArtifacts(pool,{
   key:keyBytes,retentionMs:300000,maxTotalBytes:50000000});
  try{
   assert.deepEqual(await restarted.read(lease.jobId,tenant),video);
   assert.equal(await restarted.read(lease.jobId,"synthetic-other-tenant"),null);
  }finally{restarted.close();}
 }finally{vault.close();}
 assert.equal((await pool.query("SELECT count(*)::integer AS n "+
  "FROM modo_hyperframes_staging.synthetic_receipt_attestations "+
  "WHERE job_id=$1::uuid",[lease.jobId])).rows[0].n,0);
 const latest=await queue.get(lease.jobId,tenant);
 assert.equal(latest.status,"succeeded");
 assert.equal(latest.published,false);
 assert.equal(await queue.fail(lease.jobId,tenant,workerId,lease.lease.fence),null);
 passed=true;
 process.stdout.write(JSON.stringify({
  passed:true,syntheticOnly:true,realMp4:true,renewedSameLiveLease:true,renewedDuringChromeRender:true,
  rendererLaunchSignedAndOneShot:true,mp4Sha256:outputSha256,
  outputBytes:video.length,codec:"h264",frames:150,temporalMotionVerified:true,
  v3ContinuationSigned:true,v3OutputReceiptSigned:true,leaseEpoch:1,
  replayDenied:true,tamperedVideoDenied:true,staleFenceDenied:true,
  encryptedVideoAtomic:true,readAfterRestart:true,noPublication:true
 })+"\n");
}finally{
 await pool.end();
 if(!passed)process.stderr.write("HF_REAL_RENEWED_V3_MP4_E2E_FAILED\n");
}
