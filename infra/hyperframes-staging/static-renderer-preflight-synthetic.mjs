/**
 * Trusted ephemeral CI scheduler preflight. Authorize a real staging lease
 * BEFORE Chrome starts; only public admission data crosses into renderer.
 * No server, no production integration, no persisted private keys.
 */
import {createHash,createPublicKey,generateKeyPairSync,randomUUID,
 sign as edSign,verify as edVerify} from "node:crypto";
import {readFile,writeFile,lstat} from "node:fs/promises";
import {resolve,join} from "node:path";
import pg from "pg";
import {HyperframesStagingPgQueue} from "../../apps/api/src/services/hyperframes-staging-pg-queue.ts";
import {signSyntheticLeaseOrder,acceptSyntheticLeaseOrder} from "./static-handoff-lease-v2.mjs";
import {createSyntheticLeasePgClaim} from "./static-handoff-pg-lease.mjs";
import admissionVerifier from "./static-renderer-admission.cjs";
const {verifySyntheticRendererAdmission}=admissionVerifier;
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(process.argv.length!==3||!process.argv[2].startsWith("/")||!DB_URL||
 process.env.NODE_ENV==="production"||
 process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_PREFLIGHT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
 process.env.MODO_HYPERFRAMES_RECOVERY_MODE!=="isolated-staging"){
 throw Error("HF_SYNTHETIC_PREFLIGHT_DISABLED");
}
const dir=resolve(process.argv[2]);
const hash=b=>createHash("sha256").update(b).digest("hex");
const {Pool}=pg;
const pool=new Pool({connectionString:DB_URL,max:4,ssl:false});
try{
 const db=await pool.query("SELECT current_database() AS name");
 if(db.rows[0]?.name!=="modo_hyperframes_staging")throw Error("HF_PREFLIGHT_WRONG_DB");
 const files=["order.json","public-key.pem"];
 for(const name of files){
  const st=await lstat(join(dir,name));
  if(!st.isFile()||st.isSymbolicLink()||st.size>16000)throw Error("HF_PREFLIGHT_BAD_INPUT");
 }
 const raw=await readFile(join(dir,"order.json"));
 const original=JSON.parse(raw.toString("utf8"));
 if(Object.keys(original).sort().join(",")!=="payloadB64,signatureB64")
  throw Error("HF_PREFLIGHT_BAD_ORDER");
 const bytes=Buffer.from(original.payloadB64,"base64url"),
  sig=Buffer.from(original.signatureB64,"base64url");
 if(bytes.toString("base64url")!==original.payloadB64||
  sig.length!==64||sig.toString("base64url")!==original.signatureB64)
  throw Error("HF_PREFLIGHT_BAD_ORDER");
 const orderKey=createPublicKey(await readFile(join(dir,"public-key.pem")));
 if(orderKey.asymmetricKeyType!=="ed25519"||
  !edVerify(null,bytes,orderKey,sig))throw Error("HF_PREFLIGHT_BAD_SIGNATURE");
 const order=JSON.parse(bytes.toString("utf8"));
 if(JSON.stringify(order)!==bytes.toString("utf8")||
  order.audience!=="modo-static-renderer-synthetic-ci-v1"||
  order.version!==1||order.totalFrames!==150||
  order.expiresAtMs<=Date.now()||order.issuedAtMs>Date.now()+5000||
  !/^synthetic-[a-z0-9-]{10,70}$/.test(order.jobId))
  throw Error("HF_PREFLIGHT_BAD_STORYBOARD");
 const tenant="synthetic-tenant-mp4-receipt";
 const requestSha256=hash(bytes);
 const projectId=randomUUID(),workerId="worker-ci-one",keyId="scheduler-ci-v2";
 const queue=new HyperframesStagingPgQueue(pool);
 const job=await queue.enqueue({
  organizationId:tenant,projectId,requestSha256,
  idempotencyKey:"synthetic-pref-"+randomUUID()
 },tenant);
 const lease=await queue.claim(job.jobId,tenant,workerId,60000);
 if(lease?.status!=="running"||!lease.lease)throw Error("HF_PREFLIGHT_LEASE_UNAVAILABLE");
 const expectedLease={keyId,organizationId:tenant,projectId,
  jobId:lease.jobId,workerId,leaseFence:lease.lease.fence,
  leaseVersion:lease.version,attempts:lease.attempts,requestSha256};
 const issued=Date.now(),expiry=Math.min(issued+50000,
   lease.lease.expiresAt-1000,order.expiresAtMs);
 if(expiry<issued+10000)throw Error("HF_PREFLIGHT_TTL_TOO_SHORT");
 const leaseOrder={version:2,audience:"modo-hf-lease-synthetic-v2",
  issuer:"synthetic-modo-scheduler",...expectedLease,
  nonce:randomUUID(),issuedAtMs:issued-500,expiresAtMs:expiry};
 const schedulerKeys=generateKeyPairSync("ed25519");
 const signedLease=signSyntheticLeaseOrder(leaseOrder,schedulerKeys.privateKey);
 const accepted=await acceptSyntheticLeaseOrder({
  envelope:signedLease,publicKeys:{[keyId]:schedulerKeys.publicKey},
  expected:expectedLease,nowMs:Date.now(),
  claimLease:createSyntheticLeasePgClaim(pool,expectedLease)
 });
 const admissionKeyId="trusted-scheduler-admission-ci";
 const admission={version:3,audience:"modo-static-render-admission-synthetic-v3",
  issuer:"synthetic-trusted-scheduler",keyId:admissionKeyId,
  organizationId:tenant,projectId,jobId:lease.jobId,workerId,
  leaseFence:lease.lease.fence,leaseVersion:lease.version,
  attempts:lease.attempts,requestSha256,
  leaseOrderSha256:accepted.signedRequestSha256,
  rendererJobId:order.jobId,rendererOrderSha256:hash(raw),
  nonce:randomUUID(),issuedAtMs:Date.now(),expiresAtMs:expiry};
 const admissionKeys=generateKeyPairSync("ed25519");
 const admissionBytes=Buffer.from(JSON.stringify(admission));
 const envelope={payloadB64:admissionBytes.toString("base64url"),
  signatureB64:edSign(null,admissionBytes,admissionKeys.privateKey).toString("base64url")};
 const admissionPem=admissionKeys.publicKey.export({format:"pem",type:"spki"});
 verifySyntheticRendererAdmission(envelope,admissionPem,raw,order);
 const metadata={expectedLease,rendererJobId:order.jobId,
  rendererOrderSha256:hash(raw),
  leaseOrderSha256:accepted.signedRequestSha256,
  admissionSha256:hash(admissionBytes)};
 // Release preflight metadata for trusted post-render inspection only.
 await writeFile(join(dir,"preflight-meta.json"),JSON.stringify(metadata),{flag:"wx",mode:0o600});
 await writeFile(join(dir,"admission.json"),JSON.stringify(envelope),{flag:"wx",mode:0o644});
 await writeFile(join(dir,"admission-public-key.pem"),admissionPem,{flag:"wx",mode:0o644});
 const bad={...envelope,signatureB64:
  (envelope.signatureB64[0]==="A"?"B":"A")+envelope.signatureB64.slice(1)};
 await writeFile(join(dir,"admission-tampered.json"),JSON.stringify(bad),{flag:"wx",mode:0o644});
 const expiredPayload={...admission,issuedAtMs:Date.now()-15000,expiresAtMs:Date.now()-1000};
 const ebytes=Buffer.from(JSON.stringify(expiredPayload));
 await writeFile(join(dir,"admission-expired.json"),JSON.stringify({
  payloadB64:ebytes.toString("base64url"),
  signatureB64:edSign(null,ebytes,admissionKeys.privateKey).toString("base64url")
 }),{flag:"wx",mode:0o644});
 process.stdout.write(JSON.stringify({preflight:true,syntheticOnly:true,
  authorizedBeforeRender:true,jobId:lease.jobId,
  leaseFence:lease.lease.fence,admissionSha256:metadata.admissionSha256})+"\n");
}finally{await pool.end();}
