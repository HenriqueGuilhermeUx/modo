/**
 * Synthetic-only signed continuation proof V3. This is a VERIFIER of a
 * database-backed lease epoch, NOT authorization to commit a renewed MP4.
 * The migration 010 receipt barrier remains in force.
 */
import {createHash,sign as edSign,verify as edVerify} from "node:crypto";
const FIELDS=["version","audience","issuer","keyId","organizationId","projectId",
 "jobId","workerId","leaseFence","leaseVersion","attempts","requestSha256",
 "dispatchSha256","admissionSha256","epoch","previousVersion",
 "expiresAtMs","issuedAtMs"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[a-z][a-z0-9-]{3,60}$/;
const error=()=>{throw Error("HF_SYNTHETIC_LEASE_CONTINUATION_V3_DENIED");};
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,fields)=>obj(x)&&Object.keys(x).length===fields.length&&
 fields.every(k=>Object.hasOwn(x,k));
const positive=x=>Number.isSafeInteger(x)&&x>0;
const hash=x=>createHash("sha256").update(x).digest("hex");
function gated(){
 if(process.env.NODE_ENV==="production"||
 process.env.MODO_HF_CONTINUATION_V3_MODE!=="synthetic-ci-only")error();
}
function valid(x){
 return exact(x,FIELDS)&&x.version===3&&
 x.audience==="modo-hf-renewed-lease-continuation-synthetic-v3"&&
 x.issuer==="trusted-synthetic-renewal-attestor"&&
 ID.test(x.keyId)&&
 x.organizationId==="synthetic-tenant-mp4-receipt"&&
 UUID.test(x.projectId)&&UUID.test(x.jobId)&&
 ID.test(x.workerId)&&UUID.test(x.leaseFence)&&
 positive(x.leaseVersion)&&x.attempts>=1&&x.attempts<=3&&
 Number.isSafeInteger(x.attempts)&&
 HEX.test(x.requestSha256)&&HEX.test(x.dispatchSha256)&&
 HEX.test(x.admissionSha256)&&
 [1,2].includes(x.epoch)&&positive(x.previousVersion)&&
 x.leaseVersion===x.previousVersion+1&&
 positive(x.expiresAtMs)&&positive(x.issuedAtMs)&&
 x.expiresAtMs>x.issuedAtMs&&
 x.expiresAtMs-x.issuedAtMs<=120000;
}
function checkChain({payload,currentJob,epochs,launch,nowMs}){
 if(!valid(payload)||!positive(nowMs)||!currentJob||!Array.isArray(epochs)||
 !launch||epochs.length!==payload.epoch||epochs.length>2)error();
 const p=payload;
 if(currentJob.jobId!==p.jobId||currentJob.organizationId!==p.organizationId||
 currentJob.projectId!==p.projectId||currentJob.status!=="running"||
 currentJob.previewOnly!==true||currentJob.published!==false||
 currentJob.version!==p.leaseVersion||currentJob.attempts!==p.attempts||
 currentJob.requestSha256!==p.requestSha256||
 currentJob.lease?.fence!==p.leaseFence||currentJob.lease?.workerId!==p.workerId||
 currentJob.lease?.expiresAt!==p.expiresAtMs||
 nowMs>=p.expiresAtMs||p.issuedAtMs>nowMs+5000||
 p.issuedAtMs<nowMs-60000)error();
 if(launch.jobId!==p.jobId||launch.organizationId!==p.organizationId||
 launch.leaseFence!==p.leaseFence||
 launch.dispatchSha256!==p.dispatchSha256||
 launch.admissionSha256!==p.admissionSha256||
 !positive(launch.launchedMs)||nowMs>launch.launchedMs+120000||
 p.expiresAtMs>launch.launchedMs+120000)error();
 let predecessor=null;
 for(let i=0;i<epochs.length;i++){
  const e=epochs[i];
  if(!e||e.jobId!==p.jobId||e.organizationId!==p.organizationId||
   e.leaseFence!==p.leaseFence||e.attempts!==p.attempts||
   e.dispatchSha256!==p.dispatchSha256||
   e.admissionSha256!==p.admissionSha256||
   !positive(e.renewedMs)||!positive(e.expiresMs)||
   !positive(e.fromVersion)||e.toVersion!==e.fromVersion+1||
   e.expiresMs<=e.renewedMs||e.expiresMs-e.renewedMs>60000||
   (predecessor&&(
    e.fromVersion!==predecessor.toVersion||
    e.expiresMs<=predecessor.expiresMs||
    e.renewedMs<predecessor.renewedMs)))error();
  predecessor=e;
 }
 const last=epochs.at(-1);
 if(last.toVersion!==p.leaseVersion||last.fromVersion!==p.previousVersion||
 last.expiresMs!==p.expiresAtMs)error();
 return {leaseVersion:p.leaseVersion,epoch:p.epoch,leaseFence:p.leaseFence,
  continuationSha256:hash(Buffer.from(JSON.stringify(p)))};
}
export function signSyntheticLeaseContinuationV3({payload,privateKey,context}){
 gated();
 if(privateKey?.asymmetricKeyType!=="ed25519")error();
 checkChain({payload,...context});
 const bytes=Buffer.from(JSON.stringify(payload));
 return {payloadB64:bytes.toString("base64url"),
  signatureB64:edSign(null,bytes,privateKey).toString("base64url")};
}
export function verifySyntheticLeaseContinuationV3({envelope,publicKeys,revokedKeyIds=[],
 context,nowMs}){
 gated();
 if(!exact(envelope,["payloadB64","signatureB64"])||
 typeof envelope.payloadB64!=="string"||typeof envelope.signatureB64!=="string"||
 !/^[A-Za-z0-9_-]{300,7000}$/.test(envelope.payloadB64)||
 !/^[A-Za-z0-9_-]{86}$/.test(envelope.signatureB64)||
 !obj(publicKeys)||!Array.isArray(revokedKeyIds)||!context)error();
 const bytes=Buffer.from(envelope.payloadB64,"base64url");
 const sig=Buffer.from(envelope.signatureB64,"base64url");
 if(bytes.toString("base64url")!==envelope.payloadB64||
 sig.length!==64||sig.toString("base64url")!==envelope.signatureB64)error();
 let p;try{p=JSON.parse(bytes.toString("utf8"));}catch{error();}
 if(!valid(p)||JSON.stringify(p)!==bytes.toString("utf8")||
 revokedKeyIds.includes(p.keyId)||
 !Object.hasOwn(publicKeys,p.keyId)||
 publicKeys[p.keyId]?.asymmetricKeyType!=="ed25519"||
 !edVerify(null,bytes,publicKeys[p.keyId],sig))error();
 return checkChain({payload:p,...context,nowMs});
}
