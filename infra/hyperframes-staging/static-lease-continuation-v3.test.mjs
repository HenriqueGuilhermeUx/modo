import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID,createHash} from "node:crypto";
import {signSyntheticLeaseContinuationV3,verifySyntheticLeaseContinuationV3}
 from "./static-lease-continuation-v3.mjs";
process.env.MODO_HF_CONTINUATION_V3_MODE="synthetic-ci-only";
const digest=x=>createHash("sha256").update(x).digest("hex");
const keys=generateKeyPairSync("ed25519"),keyId="renewal-attestor-v3";
function fixture(epoch=1){
 const now=Date.now(),start=now-15000;
 const jobId=randomUUID(),projectId=randomUUID(),leaseFence=randomUUID();
 const dispatchSha256=digest("dispatch"),admissionSha256=digest("admission");
 const requestSha256=digest("request"),base=3;
 const epochs=Array.from({length:epoch},(_,i)=>({
  jobId,organizationId:"synthetic-tenant-mp4-receipt",leaseFence,
  attempts:1,dispatchSha256,admissionSha256,
  fromVersion:base+i,toVersion:base+i+1,
  renewedMs:start+(i+1)*1000,expiresMs:now+25000+i*10000
 }));
 const last=epochs.at(-1);
 const payload={version:3,audience:"modo-hf-renewed-lease-continuation-synthetic-v3",
  issuer:"trusted-synthetic-renewal-attestor",keyId,
  organizationId:"synthetic-tenant-mp4-receipt",projectId,jobId,
  workerId:"worker-ci-one",leaseFence,leaseVersion:last.toVersion,attempts:1,
  requestSha256,dispatchSha256,admissionSha256,epoch,
  previousVersion:last.fromVersion,expiresAtMs:last.expiresMs,issuedAtMs:now};
 const currentJob={jobId,organizationId:payload.organizationId,projectId,
  status:"running",previewOnly:true,published:false,version:last.toVersion,
  attempts:1,requestSha256,lease:{fence:leaseFence,workerId:payload.workerId,
   expiresAt:last.expiresMs}};
 const launch={jobId,organizationId:payload.organizationId,leaseFence,
  dispatchSha256,admissionSha256,launchedMs:start};
 const context={epochs,currentJob,launch,nowMs:now};
 return {payload,context};
}
function signed(f){
 return signSyntheticLeaseContinuationV3({
  payload:f.payload,privateKey:keys.privateKey,context:f.context
 });
}
function check(f,e=signed(f)){
 return verifySyntheticLeaseContinuationV3({envelope:e,context:f.context,
  publicKeys:{[keyId]:keys.publicKey},nowMs:f.context.nowMs});
}
test("single renewal epoch signed by trusted key binds exact live fenced job",()=>{
 const f=fixture();const e=signed(f);
 const v=check(f,e);
 assert.equal(v.leaseVersion,4);assert.equal(v.epoch,1);
 assert.match(v.continuationSha256,/^[0-9a-f]{64}$/);
});
test("two consecutive audited epochs are valid; no jumps or omitted earlier epoch",()=>{
 const f=fixture(2);assert.equal(check(f).leaseVersion,5);
 f.context.epochs[1].fromVersion=3;
 assert.throws(()=>signed(f),/CONTINUATION_V3_DENIED/);
 const g=fixture(2);g.context.epochs.shift();
 assert.throws(()=>signed(g),/CONTINUATION_V3_DENIED/);
});
test("forged signature, revocation and substitution of public key are denied",()=>{
 const f=fixture(),e=signed(f);
 const forged={...e,signatureB64:(e.signatureB64[0]==="A"?"B":"A")+e.signatureB64.slice(1)};
 assert.throws(()=>check(f,forged),/CONTINUATION_V3_DENIED/);
 assert.throws(()=>verifySyntheticLeaseContinuationV3({
  envelope:e,context:f.context,publicKeys:{[keyId]:keys.publicKey},
  revokedKeyIds:[keyId],nowMs:f.context.nowMs
 }),/CONTINUATION_V3_DENIED/);
 assert.throws(()=>verifySyntheticLeaseContinuationV3({
  envelope:e,context:f.context,
  publicKeys:{[keyId]:generateKeyPairSync("ed25519").publicKey},
  nowMs:f.context.nowMs
 }),/CONTINUATION_V3_DENIED/);
});
test("current-version, tenant, fence, admission digest and expiry mismatch denied",()=>{
 const mutate=[
  f=>f.context.currentJob.version++,
  f=>f.context.currentJob.lease.fence=randomUUID(),
  f=>f.context.currentJob.organizationId="synthetic-other-tenant",
  f=>f.context.launch.admissionSha256=digest("fake"),
  f=>f.context.epochs[0].dispatchSha256=digest("fake"),
  f=>f.context.currentJob.status="succeeded",
  f=>f.context.currentJob.published=true,
  f=>f.context.nowMs=f.payload.expiresAtMs+1,
  f=>f.context.launch.launchedMs-=200000
 ];
 for(const m of mutate){
  const f=fixture(),e=signed(f);m(f);
  assert.throws(()=>check(f,e),/CONTINUATION_V3_DENIED/);
 }
});
test("cannot re-sign tampered payload after renew with stale database facts",()=>{
 const changes=[
  p=>p.leaseVersion++,
  p=>p.epoch=2,
  p=>p.previousVersion--,
  p=>p.expiresAtMs+=100,
  p=>p.attempts=2,
  p=>p.dispatchSha256=digest("fake"),
  p=>p.organizationId="synthetic-other-tenant"
 ];
 for(const edit of changes){
  const f=fixture();edit(f.payload);
  assert.throws(()=>signed(f),/CONTINUATION_V3_DENIED/);
 }
});
test("test-only gate refuses signing in NODE_ENV=production or without opt-in",()=>{
 const f=fixture();
 const prior=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV="production";
  assert.throws(()=>signed(f),/CONTINUATION_V3_DENIED/);
  delete process.env.NODE_ENV;
  delete process.env.MODO_HF_CONTINUATION_V3_MODE;
  assert.throws(()=>signed(f),/CONTINUATION_V3_DENIED/);
 }finally{
  if(prior===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=prior;
  process.env.MODO_HF_CONTINUATION_V3_MODE="synthetic-ci-only";
 }
});
