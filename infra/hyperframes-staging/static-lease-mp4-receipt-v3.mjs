/**
 * Trusted-side ED25519 v3 RECEIPT for a real synthetic H264 MP4 on a
 * *renewed* lease. Signature binds independently verified continuation v3.
 * This is proof metadata ONLY, never a publisher or final-artifact permit.
 */
import {createHash,sign as edSign,verify as edVerify} from "node:crypto";
import {verifySyntheticLeaseContinuationV3} from "./static-lease-continuation-v3.mjs";
const FIELDS=["version","audience","issuer","keyId","organizationId","projectId",
"jobId","workerId","leaseFence","leaseVersion","attempts","requestSha256",
"dispatchSha256","admissionSha256","continuationSha256","epoch","rendererJobId",
"rendererOrderSha256","outputSha256","outputBytes","codec","width","height",
"fps","frames","issuedAtMs"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/,ID=/^[a-z][a-z0-9-]{3,60}$/;
const refuse=()=>{throw Error("HF_SYNTHETIC_MP4_RECEIPT_V3_DENIED");};
const digest=b=>createHash("sha256").update(b).digest("hex");
const safe=x=>Number.isSafeInteger(x)&&x>0;
function gate(){
 if(process.env.NODE_ENV==="production"||
  process.env.MODO_HF_CONTINUATION_V3_MODE!=="synthetic-ci-only"||
  process.env.MODO_HF_MP4_RECEIPT_MODE!=="synthetic-ci-only"||
  process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")refuse();
}
function valid(p){
 return p&&typeof p==="object"&&!Array.isArray(p)&&
  Object.keys(p).length===FIELDS.length&&FIELDS.every(k=>Object.hasOwn(p,k))&&
  p.version===3&&p.audience==="modo-hf-mp4-output-renewed-synthetic-v3"&&
  p.issuer==="trusted-synthetic-renewed-mp4-attestor"&&
  typeof p.keyId==="string"&&ID.test(p.keyId)&&
  p.organizationId==="synthetic-tenant-mp4-receipt"&&
  typeof p.projectId==="string"&&UUID.test(p.projectId)&&
  typeof p.jobId==="string"&&UUID.test(p.jobId)&&
  typeof p.workerId==="string"&&ID.test(p.workerId)&&
  typeof p.leaseFence==="string"&&UUID.test(p.leaseFence)&&
  safe(p.leaseVersion)&&Number.isSafeInteger(p.attempts)&&
  p.attempts>=1&&p.attempts<=3&&
  typeof p.requestSha256==="string"&&HEX.test(p.requestSha256)&&
  typeof p.dispatchSha256==="string"&&HEX.test(p.dispatchSha256)&&
  typeof p.admissionSha256==="string"&&HEX.test(p.admissionSha256)&&
  typeof p.continuationSha256==="string"&&HEX.test(p.continuationSha256)&&
  [1,2].includes(p.epoch)&&
  typeof p.rendererJobId==="string"&&/^synthetic-[a-z0-9-]{10,70}$/.test(p.rendererJobId)&&
  typeof p.rendererOrderSha256==="string"&&HEX.test(p.rendererOrderSha256)&&
  typeof p.outputSha256==="string"&&HEX.test(p.outputSha256)&&
  safe(p.outputBytes)&&p.outputBytes>=4000&&p.outputBytes<=25000000&&
  p.codec==="h264"&&p.width===1080&&p.height===1920&&
  p.fps===30&&Number.isSafeInteger(p.frames)&&p.frames>=30&&p.frames<=360&&
  safe(p.issuedAtMs);
}
function envelopeOk(e){
 return e&&typeof e==="object"&&!Array.isArray(e)&&
 Object.keys(e).length===2&&Object.hasOwn(e,"payloadB64")&&
 Object.hasOwn(e,"signatureB64")&&
 typeof e.payloadB64==="string"&&/^[A-Za-z0-9_-]{200,12000}$/.test(e.payloadB64)&&
 typeof e.signatureB64==="string"&&/^[A-Za-z0-9_-]{86}$/.test(e.signatureB64);
}
function verifyContext(p,{continuationEnvelope,continuationPublicKeys,
 revokedContinuationKeyIds=[],context,observed,nowMs}){
 if(!context||!observed||!safe(nowMs)||
  !envelopeOk(continuationEnvelope))refuse();
 const continued=verifySyntheticLeaseContinuationV3({
  envelope:continuationEnvelope,publicKeys:continuationPublicKeys,
  revokedKeyIds:revokedContinuationKeyIds,context,nowMs});
 const c=JSON.parse(Buffer.from(continuationEnvelope.payloadB64,"base64url").toString("utf8"));
 for(const [a,b] of [["organizationId","organizationId"],["projectId","projectId"],
  ["jobId","jobId"],["workerId","workerId"],["leaseFence","leaseFence"],
  ["leaseVersion","leaseVersion"],["attempts","attempts"],
  ["requestSha256","requestSha256"],["dispatchSha256","dispatchSha256"],
  ["admissionSha256","admissionSha256"],["epoch","epoch"]]){
   if(p[a]!==c[b])refuse();
 }
 if(typeof context.launch?.rendererOrderSha256!=="string"||
  p.rendererOrderSha256!==context.launch.rendererOrderSha256||
  p.continuationSha256!==continued.continuationSha256||
  p.issuedAtMs>nowMs+5000||p.issuedAtMs<=nowMs-60000)refuse();
 const keys=["outputSha256","outputBytes","codec","width","height","fps","frames"];
 if(!keys.every(k=>p[k]===observed[k]))refuse();
 return continued;
}
export function signSyntheticMp4OutputReceiptV3({payload,privateKey,continuationEnvelope,
 continuationPublicKeys,revokedContinuationKeyIds=[],context,observed,nowMs}){
 gate();
 if(!valid(payload)||privateKey?.asymmetricKeyType!=="ed25519")refuse();
 verifyContext(payload,{continuationEnvelope,continuationPublicKeys,
  revokedContinuationKeyIds,context,observed,nowMs});
 const bytes=Buffer.from(JSON.stringify(payload));
 return {payloadB64:bytes.toString("base64url"),
 signatureB64:edSign(null,bytes,privateKey).toString("base64url")};
}
export function verifySyntheticMp4OutputReceiptV3({envelope,publicKeys,revokedKeyIds=[],
 continuationEnvelope,continuationPublicKeys,revokedContinuationKeyIds=[],
 context,observed,nowMs}){
 gate();
 if(!envelopeOk(envelope)||!publicKeys||!Array.isArray(revokedKeyIds))refuse();
 const bytes=Buffer.from(envelope.payloadB64,"base64url");
 const sig=Buffer.from(envelope.signatureB64,"base64url");
 if(bytes.toString("base64url")!==envelope.payloadB64||sig.length!==64||
  sig.toString("base64url")!==envelope.signatureB64)refuse();
 let p;try{p=JSON.parse(bytes.toString("utf8"));}catch{refuse();}
 if(!valid(p)||JSON.stringify(p)!==bytes.toString("utf8")||
  revokedKeyIds.includes(p.keyId)||
  !Object.hasOwn(publicKeys,p.keyId)||
  publicKeys[p.keyId]?.asymmetricKeyType!=="ed25519"||
  !edVerify(null,bytes,publicKeys[p.keyId],sig))refuse();
 verifyContext(p,{continuationEnvelope,continuationPublicKeys,
  revokedContinuationKeyIds,context,observed,nowMs});
 return {payload:p,receiptSha256:digest(bytes),continuationSha256:p.continuationSha256,
  observedMp4Sha256:p.outputSha256};
}
