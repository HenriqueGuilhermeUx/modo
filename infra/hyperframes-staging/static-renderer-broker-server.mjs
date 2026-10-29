/**
 * Disposable host-side broker for the standalone Chrome lab.
 * Private Ed25519 signing key lives in RAM in this process only; neither
 * PostgreSQL credentials nor private key are mounted or exposed to Chrome.
 * Each authorized browser launch MUST prove liveness via a fresh challenge.
 */
import net from "node:net";
import {createHash,generateKeyPairSync,sign as edSign} from "node:crypto";
import {readFile,writeFile,chmod,stat} from "node:fs/promises";
import {join,resolve} from "node:path";
import pg from "pg";
import {createSyntheticBrowserLaunchGate} from "./static-browser-launch-gate.mjs";
const denied=()=>{throw Error("HF_SYNTHETIC_BROKER_DENIED");};
const digest=b=>createHash("sha256").update(b).digest("hex");
const SHA=/^[0-9a-f]{64}$/, B64=/^[A-Za-z0-9_-]{43}$/;
const DB_URL=process.env.MODO_HYPERFRAMES_PG_TEST_DATABASE_URL;
if(process.env.NODE_ENV==="production"||
 process.env.MODO_HF_BROKER_SERVER_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_BROWSER_LAUNCH_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_PREFLIGHT_MODE!=="synthetic-ci-only"||
 process.env.MODO_HF_HANDOFF_MODE!=="synthetic-ci-only"||
 process.env.MODO_HYPERFRAMES_DB_MODE!=="isolated-staging"||
 !DB_URL||process.argv.length!==4||
 !process.argv[2].startsWith("/")||!process.argv[3].startsWith("/"))denied();
const input=resolve(process.argv[2]),hostDir=resolve(process.argv[3]);
const root=new pg.Pool({connectionString:DB_URL,ssl:false,max:1});
const restricted=new pg.Pool({connectionString:DB_URL,ssl:false,max:3});
const scoped={
 connect:async()=>{
  const c=await restricted.connect();
  try{await c.query("SET ROLE hf_staging_nonce_dispatcher");}
  catch(e){c.release();throw e;}
  return c;
 }
};
let server;
async function main(){
 if((await root.query("SELECT current_database() AS name")).rows[0]?.name!=="modo_hyperframes_staging")denied();
 const [orderBytes,admissionBytes,pem,metaBytes]=await Promise.all([
  readFile(join(input,"order.json")),
  readFile(join(input,"admission.json")),
  readFile(join(input,"admission-public-key.pem")),
  readFile(join(input,"preflight-meta.json"))
 ]);
 if(orderBytes.length>16000||admissionBytes.length>10000||
  pem.length>1500||metaBytes.length>16000)denied();
 const original=JSON.parse(orderBytes.toString("utf8"));
 const rendererPayload=JSON.parse(Buffer.from(original.payloadB64,"base64url").toString("utf8"));
 const envelope=JSON.parse(admissionBytes.toString("utf8"));
 const trusted=JSON.parse(metaBytes.toString("utf8"));
 const params={envelope,publicKey:pem,rendererOrderBytes:orderBytes,rendererPayload};
 const gate=createSyntheticBrowserLaunchGate(scoped,trusted);
 const keys=generateKeyPairSync("ed25519");
 const publicPem=keys.publicKey.export({format:"pem",type:"spki"});
 const dest=join(hostDir,"attest-public.pem");
 const existing=await stat(dest).then(()=>true,()=>false);
 if(existing)denied();
 await writeFile(dest,publicPem,{flag:"wx",mode:0o644});
 const sock=join(hostDir,"launch.sock");
 if(await stat(sock).then(()=>true,()=>false))denied();
 server=net.createServer(socket=>{
  let buffer="",done=false;
  socket.setTimeout(4500,()=>socket.destroy());
  socket.on("data",async chunk=>{
   if(done)return;
   buffer+=chunk.toString("utf8");
   if(buffer.length>1200){done=true;socket.end('{"denied":true}\n');return;}
   const line=buffer.indexOf("\n");
   if(line<0)return;
   done=true;
   let req;
   try{req=JSON.parse(buffer.slice(0,line));}
   catch{socket.end('{"denied":true}\n');return;}
   const allowedKeys=["version","audience","challenge","admissionSha256",
    "rendererOrderSha256","jobId","leaseFence"];
   if(!req||typeof req!=="object"||Array.isArray(req)||
      Object.keys(req).length!==allowedKeys.length||
      !allowedKeys.every(k=>Object.hasOwn(req,k))||
      req.version!==1||req.audience!=="modo-hf-broker-challenge-synthetic-v1"||
      typeof req.challenge!=="string"||!B64.test(req.challenge)||
      req.admissionSha256!==trusted.admissionSha256||
      req.rendererOrderSha256!==trusted.rendererOrderSha256||
      req.jobId!==trusted.expectedLease.jobId||
      req.leaseFence!==trusted.expectedLease.leaseFence){
    socket.end('{"denied":true}\n');return;
   }
   let won=false;
   try{won=await gate(params);}catch{
    socket.end('{"denied":true}\n');return;
   }
   if(!won){socket.end('{"denied":true}\n');return;}
   // Exactly one trusted launch consumes PostgreSQL claim.
   const now=Date.now();
   const signed={version:1,audience:"modo-hf-broker-grant-synthetic-v1",
     challenge:req.challenge,admissionSha256:trusted.admissionSha256,
     rendererOrderSha256:trusted.rendererOrderSha256,
     jobId:trusted.expectedLease.jobId,
     leaseFence:trusted.expectedLease.leaseFence,
     issuedAtMs:now,expiresAtMs:now+8000};
   const raw=Buffer.from(JSON.stringify(signed));
   const response={payloadB64:raw.toString("base64url"),
     signatureB64:edSign(null,raw,keys.privateKey).toString("base64url")};
   // The host marker is intentionally NOT mounted into Chrome.
   // Writing it before the response is a fail-closed barrier.
   try{
    await writeFile(join(input,"launch-confirmation.json"),JSON.stringify({
     syntheticOnly:true,oneShotClaimed:true,
     jobId:trusted.expectedLease.jobId,
     leaseFence:trusted.expectedLease.leaseFence,
     admissionSha256:trusted.admissionSha256
    }),{flag:"wx",mode:0o600});
   }catch{socket.end('{"denied":true}\n');return;}
   socket.end(JSON.stringify(response)+"\n");
   process.stdout.write(JSON.stringify({
    brokerGrantIssued:true,syntheticOnly:true,
    authorizationBoundToFreshChallenge:true,oneShotDbClaim:true
   })+"\n");
  });
  socket.on("error",()=>{});
 });
 server.on("error",error=>{process.stderr.write("HF_SYNTHETIC_BROKER_SOCKET_FAILED\n");});
 await new Promise((resolve,reject)=>server.listen(sock,error=>error?reject(error):resolve()));
 await chmod(sock,0o666); // Bound only into specific synthetic container in CI.
 process.stdout.write("HF_SYNTHETIC_BROKER_SOCKET_READY\n");
}
async function stop(){
 await new Promise(resolve=>server?.close(()=>resolve())??resolve());
 await restricted.end();await root.end();
}
process.once("SIGTERM",()=>{void stop().finally(()=>process.exit(0));});
process.once("SIGINT",()=>{void stop().finally(()=>process.exit(0));});
main().catch(e=>{process.stderr.write("HF_SYNTHETIC_BROKER_FAILED\n");void stop().finally(()=>process.exit(1));});
