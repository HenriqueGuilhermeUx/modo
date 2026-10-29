"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {generateKeyPairSync,sign,randomBytes,randomUUID,createHash}=require("node:crypto");
const {verifyBrokerResponse}=require("./static-renderer-broker-client.cjs");
const digest=b=>createHash("sha256").update(b).digest("hex");
const keys=generateKeyPairSync("ed25519");
const other=generateKeyPairSync("ed25519");
function make(){
 const now=Date.now();
 const expected={challenge:randomBytes(32).toString("base64url"),
  admissionSha256:digest(randomBytes(16)),
  rendererOrderSha256:digest(randomBytes(16)),
  jobId:randomUUID(),leaseFence:randomUUID()};
 const payload={version:1,audience:"modo-hf-broker-grant-synthetic-v1",
  ...expected,issuedAtMs:now-50,expiresAtMs:now+5000};
 const bytes=Buffer.from(JSON.stringify(payload));
 const envelope={payloadB64:bytes.toString("base64url"),
  signatureB64:sign(null,bytes,keys.privateKey).toString("base64url")};
 return {now,expected,payload,envelope,
  pem:keys.publicKey.export({type:"spki",format:"pem"})};
}
test("fresh broker grant binds nonce, order, job, fence and signed identity",()=>{
 const x=make();
 assert.equal(verifyBrokerResponse(x.envelope,x.pem,x.expected,x.now),true);
});
test("copying a valid grant to another container's random challenge is denied",()=>{
 const x=make();
 assert.throws(()=>verifyBrokerResponse(x.envelope,x.pem,{
  ...x.expected,challenge:randomBytes(32).toString("base64url")
 },x.now),/BROKER_GRANT_DENIED/);
});
test("wrong job, fence, admission digest or renderer digest denied",()=>{
 const x=make();
 for(const key of ["jobId","leaseFence","admissionSha256","rendererOrderSha256"]){
  const bad={...x.expected,[key]:key.endsWith("Sha256")?digest(randomBytes(8)):randomUUID()};
  assert.throws(()=>verifyBrokerResponse(x.envelope,x.pem,bad,x.now),
   /BROKER_GRANT_DENIED/);
 }
});
test("public key substitution, unsigned tampering and noncanonical response denied",()=>{
 const x=make();
 const otherPem=other.publicKey.export({type:"spki",format:"pem"});
 assert.throws(()=>verifyBrokerResponse(x.envelope,otherPem,x.expected,x.now),
  /BROKER_GRANT_DENIED/);
 const sig=x.envelope.signatureB64;
 assert.throws(()=>verifyBrokerResponse({
  ...x.envelope,signatureB64:(sig[0]==="A"?"B":"A")+sig.slice(1)
 },x.pem,x.expected,x.now),/BROKER_GRANT_DENIED/);
 const padding={...x.envelope,payloadB64:x.envelope.payloadB64+"="};
 assert.throws(()=>verifyBrokerResponse(padding,x.pem,x.expected,x.now),
  /BROKER_GRANT_DENIED/);
 const extra={...x.envelope, extra:true};
 assert.throws(()=>verifyBrokerResponse(extra,x.pem,x.expected,x.now),
  /BROKER_GRANT_DENIED/);
});
test("expired, excessive TTL and future-issued broker grant denied",()=>{
 const x=make();
 assert.throws(()=>verifyBrokerResponse(x.envelope,x.pem,x.expected,x.now+20000),
  /BROKER_GRANT_DENIED/);
 for(const changed of [
  {...x.payload,issuedAtMs:x.now+3000},
  {...x.payload,expiresAtMs:x.now+20000}
 ]){
  const bytes=Buffer.from(JSON.stringify(changed));
  const altered={payloadB64:bytes.toString("base64url"),
    signatureB64:sign(null,bytes,keys.privateKey).toString("base64url")};
  assert.throws(()=>verifyBrokerResponse(altered,x.pem,x.expected,x.now),
   /BROKER_GRANT_DENIED/);
 }
});
