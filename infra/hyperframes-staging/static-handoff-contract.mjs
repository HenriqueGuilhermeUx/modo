// Synthetic-only scheduler-side crypto contract. NOT deployed or bundled in browser.
import {createHash,sign as edSign,verify as edVerify} from "node:crypto";
const ORDER_KEYS=["version","audience","issuer","keyId","tenantId","projectId","jobId","workerId","projectSha256","orderSha256","nonce","issuedAtMs","expiresAtMs"];
const RESULT_KEYS=["version","audience","issuer","keyId","tenantId","jobId","workerId","requestSha256","orderSha256","outputSha256","status","codec","width","height","fps","frames","issuedAtMs"];
const SYN=/^synthetic-[a-z0-9-]{8,70}$/, ID=/^[a-z][a-z0-9-]{3,50}$/, HEX=/^[0-9a-f]{64}$/, UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deny=()=>{throw Error("HF_SYNTHETIC_HANDOFF_DENIED");};
const validTime=x=>Number.isSafeInteger(x)&&x>0;
const exact=(x,k)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
function gate(){if(process.env.NODE_ENV==="production"||process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only")deny();}
export const sha256=x=>createHash("sha256").update(x).digest("hex");
const orderOK=p=>exact(p,ORDER_KEYS)&&p.version===1&&p.audience==="modo-hf-handoff-synthetic-v1"&&p.issuer==="synthetic-modo-scheduler"&&ID.test(p.keyId)&&[p.tenantId,p.projectId,p.jobId].every(x=>typeof x==="string"&&SYN.test(x))&&ID.test(p.workerId)&&HEX.test(p.projectSha256)&&HEX.test(p.orderSha256)&&UUID.test(p.nonce)&&validTime(p.issuedAtMs)&&validTime(p.expiresAtMs)&&p.expiresAtMs>p.issuedAtMs&&p.expiresAtMs-p.issuedAtMs<=60000;
const resultOK=p=>exact(p,RESULT_KEYS)&&p.version===1&&p.audience==="modo-hf-receipt-synthetic-v1"&&p.issuer==="synthetic-hf-worker"&&ID.test(p.keyId)&&SYN.test(p.tenantId)&&SYN.test(p.jobId)&&ID.test(p.workerId)&&[p.requestSha256,p.orderSha256,p.outputSha256].every(x=>typeof x==="string"&&HEX.test(x))&&p.status==="complete"&&p.codec==="h264"&&p.width===1080&&p.height===1920&&p.fps===30&&Number.isSafeInteger(p.frames)&&p.frames>=30&&p.frames<=360&&validTime(p.issuedAtMs);
function sign(p,key,check){gate();if(!check(p)||!key)deny();const bytes=Buffer.from(JSON.stringify(p));return {payloadB64:bytes.toString("base64url"),signatureB64:edSign(null,bytes,key).toString("base64url")};}
function verify(envelope,keys,revoked,check){
 gate();
 if(!exact(envelope,["payloadB64","signatureB64"])||typeof envelope.payloadB64!=="string"||typeof envelope.signatureB64!=="string"||!/^[A-Za-z0-9_-]{50,10000}$/.test(envelope.payloadB64)||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signatureB64))deny();
 const bytes=Buffer.from(envelope.payloadB64,"base64url"),signature=Buffer.from(envelope.signatureB64,"base64url");
 if(bytes.toString("base64url")!==envelope.payloadB64||signature.length!==64||signature.toString("base64url")!==envelope.signatureB64)deny();
 let p;try{p=JSON.parse(bytes.toString("utf8"));}catch{deny();}
 if(!check(p)||JSON.stringify(p)!==bytes.toString("utf8")||!keys||!Object.hasOwn(keys,p.keyId)||!keys[p.keyId]||(revoked||[]).includes(p.keyId))deny();
 try{if(!edVerify(null,bytes,keys[p.keyId],signature))deny();}catch{deny();}
 return {payload:p,requestSha256:sha256(bytes)};
}
export function signSyntheticHandoff(p,key){return sign(p,key,orderOK);}
export async function acceptSyntheticHandoff({envelope,publicKeys,revokedKeyIds,expected,nowMs,consumeNonce}){
 const checked=verify(envelope,publicKeys,revokedKeyIds,orderOK),p=checked.payload;
 if(!validTime(nowMs)||p.issuedAtMs>nowMs+5000||p.issuedAtMs<nowMs-60000||p.expiresAtMs<=nowMs||typeof consumeNonce!=="function")deny();
 // Authorization MUST derive from the authenticated service and trusted job row.
 if(!expected||!["tenantId","projectId","jobId","workerId","projectSha256","orderSha256"].every(k=>expected[k]===p[k]))deny();
 // Atomic durable unique-claim REQUIRED in a later staging adapter. No browser DB.
 if(await consumeNonce(p.tenantId,p.nonce,p.expiresAtMs)!==true)deny();
 return checked;
}
export function signSyntheticReceipt(p,key){return sign(p,key,resultOK);}
export function verifySyntheticReceipt({envelope,publicKeys,revokedKeyIds,expected,observedMp4Sha256,nowMs}){
 const {payload:p}=verify(envelope,publicKeys,revokedKeyIds,resultOK);
 if(!validTime(nowMs)||Math.abs(nowMs-p.issuedAtMs)>60000||typeof observedMp4Sha256!=="string"||!HEX.test(observedMp4Sha256)||observedMp4Sha256!==p.outputSha256)deny();
 if(!expected||!["tenantId","jobId","workerId","requestSha256","orderSha256","width","height","fps","frames","codec"].every(k=>expected[k]===p[k]))deny();
 return {payload:p,verifiedMp4Sha256:observedMp4Sha256};
}
