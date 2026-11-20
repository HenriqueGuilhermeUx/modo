/**
 * Separate trusted-process Ed25519 receipt for a REAL synthetic MP4.
 * No private key enters the standalone Chrome renderer. CI/lab ONLY.
 * Not a production artifact commit, a publisher receipt or service auth.
 */
import {createHash,sign as edSign,verify as edVerify} from "node:crypto";
const FIELDS=["version","audience","issuer","keyId","organizationId","projectId","jobId",
 "workerId","leaseFence","leaseVersion","attempts","requestSha256",
 "leaseOrderSha256","rendererJobId","rendererOrderSha256","outputSha256",
 "outputBytes","codec","width","height","fps","frames","issuedAtMs"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
 SYN=/^synthetic-[a-z0-9-]{8,70}$/,
 ID=/^[a-z][a-z0-9-]{3,50}$/,HEX=/^[0-9a-f]{64}$/;
const deny=()=>{throw Error("HF_SYNTHETIC_MP4_RECEIPT_DENIED");};
const safe=x=>Number.isSafeInteger(x)&&x>0;
function gate(){
 if(process.env.NODE_ENV==="production"||
   process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
   process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
   process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only")deny();
}
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
function valid(p){
 if(!p||typeof p!=="object"||Array.isArray(p)||
    Object.keys(p).length!==FIELDS.length||
    !FIELDS.every(k=>Object.hasOwn(p,k)))return false;
 return p.version===2&&p.audience==="modo-hf-mp4-receipt-synthetic-v2"&&
  p.issuer==="synthetic-trusted-mp4-attestor"&&
  typeof p.keyId==="string"&&ID.test(p.keyId)&&
  typeof p.organizationId==="string"&&SYN.test(p.organizationId)&&
  typeof p.projectId==="string"&&UUID.test(p.projectId)&&
  typeof p.jobId==="string"&&UUID.test(p.jobId)&&
  typeof p.workerId==="string"&&ID.test(p.workerId)&&
  typeof p.leaseFence==="string"&&UUID.test(p.leaseFence)&&
  safe(p.leaseVersion)&&Number.isSafeInteger(p.attempts)&&
  p.attempts>=1&&p.attempts<=3&&
  typeof p.requestSha256==="string"&&HEX.test(p.requestSha256)&&
  typeof p.leaseOrderSha256==="string"&&HEX.test(p.leaseOrderSha256)&&
  typeof p.rendererJobId==="string"&&/^synthetic-[a-z0-9-]{10,70}$/.test(p.rendererJobId)&&
  typeof p.rendererOrderSha256==="string"&&HEX.test(p.rendererOrderSha256)&&
  typeof p.outputSha256==="string"&&HEX.test(p.outputSha256)&&
  safe(p.outputBytes)&&p.outputBytes>=4000&&p.outputBytes<=25000000&&
  p.codec==="h264"&&p.width===1080&&p.height===1920&&p.fps===30&&
  Number.isSafeInteger(p.frames)&&p.frames>=30&&p.frames<=360&&
  safe(p.issuedAtMs);
}
function exactEnvelope(x){
 return x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).length===2&&Object.hasOwn(x,"payloadB64")&&
  Object.hasOwn(x,"signatureB64")&&
  typeof x.payloadB64==="string"&&typeof x.signatureB64==="string"&&
  /^[A-Za-z0-9_-]{100,12000}$/.test(x.payloadB64)&&
  /^[A-Za-z0-9_-]{86}$/.test(x.signatureB64);
}
export function signSyntheticMp4LeaseReceipt(payload,privateKey){
 gate();
 if(!valid(payload)||privateKey?.asymmetricKeyType!=="ed25519")deny();
 const bytes=Buffer.from(JSON.stringify(payload));
 return {payloadB64:bytes.toString("base64url"),
  signatureB64:edSign(null,bytes,privateKey).toString("base64url")};
}
/**
 * expected and currentJob MUST originate from the authorized staging
 * scheduler/queue, not from the received envelope. 'observed' is measured
 * independently from the actual MP4 bytes and FFprobe in the trusted sidecar.
 * This only verifies a snapshot: no atomic final commit/fence is implemented.
 */
export function verifySyntheticMp4LeaseReceipt({
 envelope,publicKeys,revokedKeyIds=[],expected,currentJob,observed,nowMs
}){
 gate();
 if(!exactEnvelope(envelope)||!publicKeys||!expected||!currentJob||!observed||
    !Array.isArray(revokedKeyIds)||!safe(nowMs))deny();
 const bytes=Buffer.from(envelope.payloadB64,"base64url"),
   signature=Buffer.from(envelope.signatureB64,"base64url");
 if(bytes.toString("base64url")!==envelope.payloadB64||
    signature.length!==64||signature.toString("base64url")!==envelope.signatureB64)deny();
 let p;
 try{p=JSON.parse(bytes.toString("utf8"));}catch{deny();}
 if(!valid(p)||JSON.stringify(p)!==bytes.toString("utf8")||
   !Object.hasOwn(publicKeys,p.keyId)||revokedKeyIds.includes(p.keyId)||
   publicKeys[p.keyId]?.asymmetricKeyType!=="ed25519")deny();
 try{if(!edVerify(null,bytes,publicKeys[p.keyId],signature))deny();}
 catch{deny();}
 const keys=["keyId","organizationId","projectId","jobId","workerId","leaseFence",
  "leaseVersion","attempts","requestSha256","leaseOrderSha256",
  "rendererJobId","rendererOrderSha256"];
 if(!keys.every(k=>expected[k]===p[k])||
    p.issuedAtMs>nowMs+5000||p.issuedAtMs<=nowMs-60000)deny();
 if(observed.outputSha256!==p.outputSha256||
    observed.outputBytes!==p.outputBytes||
    observed.codec!==p.codec||observed.width!==p.width||
    observed.height!==p.height||observed.fps!==p.fps||
    observed.frames!==p.frames)deny();
 // Independently fetched current queue state, including the live fence.
 if(currentJob.status!=="running"||
    currentJob.previewOnly!==true||currentJob.published!==false||
    currentJob.organizationId!==p.organizationId||
    currentJob.projectId!==p.projectId||currentJob.jobId!==p.jobId||
    currentJob.requestSha256!==p.requestSha256||
    currentJob.version!==p.leaseVersion||currentJob.attempts!==p.attempts||
    currentJob.lease?.fence!==p.leaseFence||
    currentJob.lease?.workerId!==p.workerId||
    !safe(currentJob.lease?.expiresAt)||currentJob.lease.expiresAt<=nowMs)deny();
 return {payload:p,receiptSha256:digest(bytes),verifiedMp4Sha256:p.outputSha256};
}
