/**
 * Synthetic-only Ed25519 v2 order bound to a real isolated PG staging lease.
 * Trusted Node scheduler-side only. Never import into Chrome or production.
 */
import {createHash, sign as edSign, verify as edVerify} from "node:crypto";
const FIELDS=["version","audience","issuer","keyId","organizationId","projectId","jobId","workerId","leaseFence","leaseVersion","attempts","requestSha256","nonce","issuedAtMs","expiresAtMs"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
 SYN=/^synthetic-[a-z0-9-]{8,70}$/,ID=/^[a-z][a-z0-9-]{3,50}$/,HEX=/^[0-9a-f]{64}$/;
const deny=()=>{throw Error("HF_SYNTHETIC_LEASE_DENIED");};
const safe=x=>Number.isSafeInteger(x)&&x>0;
function gate(){
 if(process.env.NODE_ENV==="production"||
    process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
    process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging")deny();
}
function valid(p){
 if(!p||typeof p!=="object"||Array.isArray(p)||
    Object.keys(p).length!==FIELDS.length||
    !FIELDS.every(x=>Object.hasOwn(p,x)))return false;
 return p.version===2&&p.audience==="modo-hf-lease-synthetic-v2"&&
   p.issuer==="synthetic-modo-scheduler"&&
   typeof p.keyId==="string"&&ID.test(p.keyId)&&
   typeof p.organizationId==="string"&&SYN.test(p.organizationId)&&
   typeof p.projectId==="string"&&UUID.test(p.projectId)&&
   typeof p.jobId==="string"&&UUID.test(p.jobId)&&
   typeof p.workerId==="string"&&ID.test(p.workerId)&&
   typeof p.leaseFence==="string"&&UUID.test(p.leaseFence)&&
   safe(p.leaseVersion)&&Number.isSafeInteger(p.attempts)&&
   p.attempts>=1&&p.attempts<=3&&
   typeof p.requestSha256==="string"&&HEX.test(p.requestSha256)&&
   typeof p.nonce==="string"&&UUID.test(p.nonce)&&
   safe(p.issuedAtMs)&&safe(p.expiresAtMs)&&
   p.expiresAtMs>p.issuedAtMs&&p.expiresAtMs-p.issuedAtMs<=60000;
}
export function signSyntheticLeaseOrder(payload, privateKey){
 gate();
 if(!valid(payload)||privateKey?.asymmetricKeyType!=="ed25519")deny();
 const bytes=Buffer.from(JSON.stringify(payload));
 return {payloadB64:bytes.toString("base64url"),
   signatureB64:edSign(null,bytes,privateKey).toString("base64url")};
}
/**
 * expected MUST originate in authenticated, trusted scheduler state,
 * not from the signed payload nor any browser-provided metadata.
 * claimLease MUST atomically compare a current PG lease and consume nonce.
 */
export async function acceptSyntheticLeaseOrder({
 envelope,publicKeys,revokedKeyIds=[],expected,nowMs,claimLease
}){
 gate();
 if(!envelope||typeof envelope!=="object"||Array.isArray(envelope)||
   Object.keys(envelope).length!==2||
   !Object.hasOwn(envelope,"payloadB64")||
   !Object.hasOwn(envelope,"signatureB64")||
   typeof envelope.payloadB64!=="string"||
   typeof envelope.signatureB64!=="string"||
   !/^[A-Za-z0-9_-]{100,10000}$/.test(envelope.payloadB64)||
   !/^[A-Za-z0-9_-]{86}$/.test(envelope.signatureB64))deny();
 const bytes=Buffer.from(envelope.payloadB64,"base64url"),
   sig=Buffer.from(envelope.signatureB64,"base64url");
 if(bytes.toString("base64url")!==envelope.payloadB64||
    sig.length!==64||sig.toString("base64url")!==envelope.signatureB64)deny();
 let p;try{p=JSON.parse(bytes.toString("utf8"));}catch{deny();}
 if(!valid(p)||JSON.stringify(p)!==bytes.toString("utf8")||
   !publicKeys||!Object.hasOwn(publicKeys,p.keyId)||
   revokedKeyIds.includes(p.keyId)||
   publicKeys[p.keyId]?.asymmetricKeyType!=="ed25519")deny();
 try{if(!edVerify(null,bytes,publicKeys[p.keyId],sig))deny();}
 catch{deny();}
 if(!safe(nowMs)||p.issuedAtMs>nowMs+5000||
    p.issuedAtMs<nowMs-60000||p.expiresAtMs<=nowMs||
    !expected||typeof claimLease!=="function"||
    !["keyId","organizationId","projectId","jobId","workerId","leaseFence",
      "leaseVersion","attempts","requestSha256"].every(k=>expected[k]===p[k]))deny();
 const signedRequestSha256=createHash("sha256").update(bytes).digest("hex");
 // This is the only side effect: atomic lease-bound claim in trusted PG.
 if(await claimLease(p,signedRequestSha256)!==true)deny();
 return {payload:p,signedRequestSha256};
}
