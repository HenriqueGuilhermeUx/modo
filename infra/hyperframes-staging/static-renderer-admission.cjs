"use strict";
/** Public-key-only signed pre-render admission; safe to include in browser
 * image. No DB, private keys, signing methods, fetch or side effects. */
const crypto=require("node:crypto");
const fs=require("node:fs");
const KEYS=["version","audience","issuer","keyId","organizationId","projectId",
"jobId","workerId","leaseFence","leaseVersion","attempts","requestSha256",
"leaseOrderSha256","rendererJobId","rendererOrderSha256","nonce",
"issuedAtMs","expiresAtMs"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
SYN=/^synthetic-[a-z0-9-]{8,70}$/,ID=/^[a-z][a-z0-9-]{3,50}$/,HEX=/^[0-9a-f]{64}$/;
const DENIED="HF_STATIC_RENDERER_ADMISSION_DENIED";
const deny=()=>{throw Error(DENIED);};
function exact(x,keys){return x&&typeof x==="object"&&!Array.isArray(x)&&
Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));}
function valid(p){
 return exact(p,KEYS)&&p.version===3&&
 p.audience==="modo-static-render-admission-synthetic-v3"&&
 p.issuer==="synthetic-trusted-scheduler"&&
 typeof p.keyId==="string"&&ID.test(p.keyId)&&
 typeof p.organizationId==="string"&&SYN.test(p.organizationId)&&
 typeof p.projectId==="string"&&UUID.test(p.projectId)&&
 typeof p.jobId==="string"&&UUID.test(p.jobId)&&
 typeof p.workerId==="string"&&ID.test(p.workerId)&&
 typeof p.leaseFence==="string"&&UUID.test(p.leaseFence)&&
 Number.isSafeInteger(p.leaseVersion)&&p.leaseVersion>=1&&
 Number.isSafeInteger(p.attempts)&&p.attempts>=1&&p.attempts<=3&&
 typeof p.requestSha256==="string"&&HEX.test(p.requestSha256)&&
 typeof p.leaseOrderSha256==="string"&&HEX.test(p.leaseOrderSha256)&&
 typeof p.rendererJobId==="string"&&/^synthetic-[a-z0-9-]{10,70}$/.test(p.rendererJobId)&&
 typeof p.rendererOrderSha256==="string"&&HEX.test(p.rendererOrderSha256)&&
 typeof p.nonce==="string"&&UUID.test(p.nonce)&&
 Number.isSafeInteger(p.issuedAtMs)&&p.issuedAtMs>0&&
 Number.isSafeInteger(p.expiresAtMs)&&p.expiresAtMs>p.issuedAtMs&&
 p.expiresAtMs-p.issuedAtMs<=60000;
}
/** Reject both invalid signatures and a valid authorization for another order. */
function verifySyntheticRendererAdmission(envelope,pem,rendererOrderBytes,rendererPayload,now=Date.now()){
 if(!exact(envelope,["payloadB64","signatureB64"])||
   typeof envelope.payloadB64!=="string"||
   typeof envelope.signatureB64!=="string"||
   !/^[A-Za-z0-9_-]{250,7000}$/.test(envelope.payloadB64)||
   !/^[A-Za-z0-9_-]{86}$/.test(envelope.signatureB64)||
   !Buffer.isBuffer(rendererOrderBytes)||
   rendererOrderBytes.length>16000||rendererOrderBytes.length<100||
   !rendererPayload||typeof rendererPayload.jobId!=="string"||
   !Number.isSafeInteger(now)||now<=0)deny();
 const b=Buffer.from(envelope.payloadB64,"base64url");
 const sig=Buffer.from(envelope.signatureB64,"base64url");
 if(b.toString("base64url")!==envelope.payloadB64||
   sig.length!==64||sig.toString("base64url")!==envelope.signatureB64)deny();
 let key,p;
 try{
  key=crypto.createPublicKey(pem);
  p=JSON.parse(b.toString("utf8"));
 }catch{deny();}
 if(key.asymmetricKeyType!=="ed25519"||!valid(p)||
   JSON.stringify(p)!==b.toString("utf8")||
   !crypto.verify(null,b,key,sig)||p.issuedAtMs>now+5000||
   p.issuedAtMs<now-60000||p.expiresAtMs<=now||
   p.rendererJobId!==rendererPayload.jobId||
   p.rendererOrderSha256!==crypto.createHash("sha256")
     .update(rendererOrderBytes).digest("hex"))deny();
 return {jobId:p.jobId,leaseFence:p.leaseFence,
   requestSha256:p.requestSha256,admissionNonce:p.nonce};
}
function verifySyntheticRendererAdmissionFiles(orderBytes,payload){
 const paths=["/input/admission.json","/input/admission-public-key.pem"];
 for(const p of paths){
  let st;try{st=fs.lstatSync(p);}catch{deny();}
  if(!st.isFile()||st.isSymbolicLink()||st.size<32||
     st.size>(p.endsWith(".json")?10000:1500))deny();
 }
 let e;try{e=JSON.parse(fs.readFileSync(paths[0],"utf8"));}catch{deny();}
 return verifySyntheticRendererAdmission(
  e,fs.readFileSync(paths[1]),orderBytes,payload);
}
module.exports={verifySyntheticRendererAdmission,
 verifySyntheticRendererAdmissionFiles};
