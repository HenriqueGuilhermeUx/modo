"use strict";
/**
 * Offline, public-key-only browser-side broker client.
 * A short-lived challenge is signed by trusted host broker whose public key
 * is BAKED INTO the per-run container image. Never trust a mounted public key.
 * No DB, HMAC secrets, outbound network, user HTML, or private keys in Chrome.
 */
const net=require("node:net");
const crypto=require("node:crypto");
const fs=require("node:fs");
const DENIED="HF_STATIC_RENDERER_BROKER_GRANT_DENIED";
const deny=()=>{throw Error(DENIED);};
const SHA=/^[0-9a-f]{64}$/, UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canon=x=>JSON.stringify(x);
const digest=x=>crypto.createHash("sha256").update(x).digest("hex");
function verifyBrokerResponse(envelope,pinnedPem,expected,now=Date.now()){
 if(!envelope||typeof envelope!=="object"||Array.isArray(envelope)||
  Object.keys(envelope).length!==2||
  typeof envelope.payloadB64!=="string"||typeof envelope.signatureB64!=="string"||
  !/^[A-Za-z0-9_-]{180,3000}$/.test(envelope.payloadB64)||
  !/^[A-Za-z0-9_-]{86}$/.test(envelope.signatureB64)||!expected||
  !Number.isSafeInteger(now))deny();
 const raw=Buffer.from(envelope.payloadB64,"base64url");
 const signature=Buffer.from(envelope.signatureB64,"base64url");
 if(raw.toString("base64url")!==envelope.payloadB64||
  signature.toString("base64url")!==envelope.signatureB64||
  signature.length!==64)deny();
 let key,p;
 try{
  key=crypto.createPublicKey(pinnedPem);
  p=JSON.parse(raw.toString("utf8"));
 }catch{deny();}
 const keys=["version","audience","challenge","admissionSha256",
  "rendererOrderSha256","jobId","leaseFence","issuedAtMs","expiresAtMs"];
 if(key.asymmetricKeyType!=="ed25519"||
  !p||typeof p!=="object"||Array.isArray(p)||
  Object.keys(p).length!==keys.length||!keys.every(k=>Object.hasOwn(p,k))||
  p.version!==1||p.audience!=="modo-hf-broker-grant-synthetic-v1"||
  p.challenge!==expected.challenge||
  p.admissionSha256!==expected.admissionSha256||
  p.rendererOrderSha256!==expected.rendererOrderSha256||
  p.jobId!==expected.jobId||p.leaseFence!==expected.leaseFence||
  !Number.isSafeInteger(p.issuedAtMs)||
  !Number.isSafeInteger(p.expiresAtMs)||p.issuedAtMs>now+1000||
  p.expiresAtMs<=now||p.expiresAtMs>p.issuedAtMs+10000||
  canon(p)!==raw.toString("utf8")||
  !crypto.verify(null,raw,key,signature))deny();
 return true;
}
function parseAdmission(admissionBytes){
 let envelope,p;try{
  envelope=JSON.parse(admissionBytes.toString("utf8"));
  p=JSON.parse(Buffer.from(envelope.payloadB64,"base64url").toString("utf8"));
 }catch{deny();}
 if(!p||!UUID.test(p.jobId)||!UUID.test(p.leaseFence)||
  !SHA.test(p.rendererOrderSha256)||
  !SHA.test(digest(Buffer.from(envelope.payloadB64,"base64url"))))deny();
 return {p,envelope};
}
/** Called after Ed25519 authorization verification, before Chrome is launched. */
async function requireSyntheticBrokerGrant(orderBytes){
 if(process.env.NODE_ENV==="production"||
  process.env.MODO_HF_STATIC_BROKER_MODE!=="synthetic-ci-only"||
  !Buffer.isBuffer(orderBytes)||orderBytes.length<100||orderBytes.length>16000)deny();
 let pub,admissionBytes;
 try{
  pub=fs.readFileSync("/opt/hf-broker-pinned.pem");
  admissionBytes=fs.readFileSync("/input/admission.json");
 }catch{deny();}
 const {p,envelope}=parseAdmission(admissionBytes);
 const challenge=crypto.randomBytes(32).toString("base64url");
 const expected={challenge,jobId:p.jobId,leaseFence:p.leaseFence,
  admissionSha256:digest(Buffer.from(envelope.payloadB64,"base64url")),
  rendererOrderSha256:digest(orderBytes)};
 if(expected.rendererOrderSha256!==p.rendererOrderSha256)deny();
 const request=JSON.stringify({version:1,audience:"modo-hf-broker-challenge-synthetic-v1",
  challenge,admissionSha256:expected.admissionSha256,
  rendererOrderSha256:expected.rendererOrderSha256,
  jobId:p.jobId,leaseFence:p.leaseFence});
 if(request.length>1000)deny();
 return await new Promise((resolve,reject)=>{
  let done=false,text="";
  const socket=net.createConnection({path:"/broker/launch.sock"});
  const rejectOnce=()=>{
   if(done)return;
   done=true;socket.destroy();reject(Error(DENIED));
  };
  socket.setTimeout(4500);
  socket.on("error",rejectOnce);
  socket.on("timeout",rejectOnce);
  socket.on("connect",()=>socket.write(request+"\n"));
  socket.on("data",chunk=>{
   text+=chunk.toString("utf8");
   if(text.length>4000){rejectOnce();return;}
   const pos=text.indexOf("\n");
   if(pos===-1)return;
   if(done)return;
   let reply;try{reply=JSON.parse(text.slice(0,pos));}catch{rejectOnce();return;}
   try{verifyBrokerResponse(reply,pub,expected);}
   catch{rejectOnce();return;}
   done=true;socket.end();resolve(true);
  });
  socket.on("end",()=>{if(!done)rejectOnce();});
 });
}
module.exports={verifyBrokerResponse,requireSyntheticBrokerGrant};
