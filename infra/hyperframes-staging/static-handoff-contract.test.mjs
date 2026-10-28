import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,randomUUID} from "node:crypto";
import {acceptSyntheticHandoff,sha256,signSyntheticHandoff,signSyntheticReceipt,verifySyntheticReceipt} from "./static-handoff-contract.mjs";
process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";
const a=generateKeyPairSync("ed25519"),b=generateKeyPairSync("ed25519"),N=1800000000000;
const hash=s=>sha256(Buffer.from(s));
const p=()=>({version:1,audience:"modo-hf-handoff-synthetic-v1",issuer:"synthetic-modo-scheduler",keyId:"scheduler-ci-v1",tenantId:"synthetic-tenant-one",projectId:"synthetic-project-one",jobId:"synthetic-job-one",workerId:"worker-ci-one",projectSha256:hash("project"),orderSha256:hash("order"),nonce:randomUUID(),issuedAtMs:N-1000,expiresAtMs:N+30000});
const expected=x=>Object.fromEntries(["tenantId","projectId","jobId","workerId","projectSha256","orderSha256"].map(k=>[k,x[k]]));
const claims=()=>{const s=new Set();return async(_,nonce)=>!s.has(nonce)&&!!s.add(nonce);};
const opts=x=>({envelope:signSyntheticHandoff(x,a.privateKey),publicKeys:{"scheduler-ci-v1":a.publicKey},expected:expected(x),nowMs:N,consumeNonce:claims()});
test("valid handoff, then reject sequential and concurrent replay",async()=>{
 const x=p(),o=opts(x);
 assert.equal((await acceptSyntheticHandoff(o)).payload.jobId,x.jobId);
 await assert.rejects(acceptSyntheticHandoff(o),/DENIED/);
 const two=opts(p());
 const results=await Promise.allSettled([acceptSyntheticHandoff(two),acceptSyntheticHandoff(two)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(results.filter(r=>r.status==="rejected").length,1);
});
test("tenant, project, job, worker and both hashes must be authorized independently",async()=>{
 const x=p();let seen=0;
 for(const k of ["tenantId","projectId","jobId","workerId","projectSha256","orderSha256"]){
  await assert.rejects(acceptSyntheticHandoff({...opts(x),expected:{...expected(x),[k]:"wrong"},consumeNonce:async()=>{seen++;return true;}}),/DENIED/);
 }
 assert.equal(seen,0);
});
test("reject tampering, unknown key, revocation and missing atomic claim",async()=>{
 const x=p(),o=opts(x),s=o.envelope.signatureB64;
 await assert.rejects(acceptSyntheticHandoff({...o,envelope:{...o.envelope,signatureB64:(s[0]==="A"?"B":"A")+s.slice(1)}}),/DENIED/);
 await assert.rejects(acceptSyntheticHandoff({...o,publicKeys:{}}),/DENIED/);
 await assert.rejects(acceptSyntheticHandoff({...o,revokedKeyIds:["scheduler-ci-v1"]}),/DENIED/);
 await assert.rejects(acceptSyntheticHandoff({...o,consumeNonce:undefined}),/DENIED/);
 await assert.rejects(acceptSyntheticHandoff({...o,consumeNonce:async()=>false}),/DENIED/);
});
test("reject expired, future, unknown audience, real identifiers and excessive TTL",async()=>{
 const x=p();
 await assert.rejects(acceptSyntheticHandoff(opts({...x,issuedAtMs:N-90000,expiresAtMs:N-60000})),/DENIED/);
 await assert.rejects(acceptSyntheticHandoff(opts({...x,issuedAtMs:N+6000,expiresAtMs:N+10000})),/DENIED/);
 for(const y of [{audience:"wrong"},{tenantId:"customer-real"},{expiresAtMs:N+90000}])
  assert.throws(()=>signSyntheticHandoff({...x,...y},a.privateKey),/DENIED/);
});
test("signed receipt is tied to handoff and independently measured output digest",async()=>{
 const x=p(),accepted=await acceptSyntheticHandoff(opts(x)),out=hash("synthetic-fake-mp4-bytes");
 const receipt={version:1,audience:"modo-hf-receipt-synthetic-v1",issuer:"synthetic-hf-worker",keyId:"worker-ci-v1",tenantId:x.tenantId,jobId:x.jobId,workerId:x.workerId,requestSha256:accepted.requestSha256,orderSha256:x.orderSha256,outputSha256:out,status:"complete",codec:"h264",width:1080,height:1920,fps:30,frames:150,issuedAtMs:N};
 const envelope=signSyntheticReceipt(receipt,b.privateKey);
 const good={envelope,publicKeys:{"worker-ci-v1":b.publicKey},expected:{tenantId:x.tenantId,jobId:x.jobId,workerId:x.workerId,requestSha256:accepted.requestSha256,orderSha256:x.orderSha256,width:1080,height:1920,fps:30,frames:150,codec:"h264"},observedMp4Sha256:out,nowMs:N};
 assert.equal(verifySyntheticReceipt(good).verifiedMp4Sha256,out);
 for(const change of [{observedMp4Sha256:hash("bad")},{expected:{...good.expected,requestSha256:hash("bad")}},{expected:{...good.expected,tenantId:"synthetic-other-tenant"}},{revokedKeyIds:["worker-ci-v1"]},{nowMs:N+61000},{publicKeys:{}}])assert.throws(()=>verifySyntheticReceipt({...good,...change}),/DENIED/);
 const s=envelope.signatureB64;assert.throws(()=>verifySyntheticReceipt({...good,envelope:{...envelope,signatureB64:(s[0]==="A"?"B":"A")+s.slice(1)}}),/DENIED/);
});
test("fails closed outside synthetic fixture mode and in production",()=>{
 const x=p(),mode=process.env.MODO_HF_HANDOFF_MODE,env=process.env.NODE_ENV;
 try{
  delete process.env.MODO_HF_HANDOFF_MODE;assert.throws(()=>signSyntheticHandoff(x,a.privateKey),/DENIED/);
  process.env.MODO_HF_HANDOFF_MODE="synthetic-ci-only";process.env.NODE_ENV="production";
  assert.throws(()=>signSyntheticHandoff(x,a.privateKey),/DENIED/);
 }finally{process.env.MODO_HF_HANDOFF_MODE=mode;if(env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=env;}
});
