/**
 * Measured, deliberately NON-PASSING visual parity audit.
 * Remotion is the unchanged commercial visual reference. An isolated
 * synthetic 150-frame signed HyperFrames MP4 is sampled at three interior
 * scene frames, normalized to Remotion's original 720x1280 dimensions.
 * Metrics are observations, NOT a claim of equivalence or product approval.
 * All media/stills are ephemeral, no upload, production service or customer data.
 */
import assert from "node:assert/strict";
import {createHash,createPublicKey,verify as edVerify} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdtemp,readFile,lstat,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {bundle} from "@remotion/bundler";
import {renderStill,selectComposition} from "@remotion/renderer";
const run=promisify(execFile);
const disabled=()=>{throw Error("HF_REMOTION_PARITY_AUDIT_DISABLED");};
if(process.env.NODE_ENV==="production"||
 process.env.MODO_HF_VISUAL_PARITY_MODE!=="synthetic-ci-only"||
 process.argv.length!==4||!process.argv[2].startsWith("/")||
 !process.argv[3].startsWith("/"))disabled();
const inputDir=resolve(process.argv[2]),video=resolve(process.argv[3]);
const sha=x=>createHash("sha256").update(x).digest("hex");
const workdir=await mkdtemp(join(tmpdir(),"modo-hf-remotion-compare-"));
async function ff(args){
 const {stdout,stderr}=await run("/usr/bin/ffmpeg",args,{
  timeout:120000,maxBuffer:256000});
 return stdout+"\n"+stderr;
}
let completed=false;
try{
 const inputStat=await lstat(video);
 assert.ok(inputStat.isFile()&&!inputStat.isSymbolicLink());
 assert.ok(inputStat.size>4000&&inputStat.size<25000000);
 const videoBytes=await readFile(video);
 assert.equal(videoBytes.toString("ascii",4,8),"ftyp");
 const orderBytes=await readFile(join(inputDir,"order.json"));
 const order=JSON.parse(orderBytes.toString("utf8"));
 assert.deepEqual(Object.keys(order).sort(),["payloadB64","signatureB64"]);
 const payloadBytes=Buffer.from(order.payloadB64,"base64url");
 const signature=Buffer.from(order.signatureB64,"base64url");
 assert.equal(payloadBytes.toString("base64url"),order.payloadB64);
 assert.equal(signature.length,64);
 const publicKey=createPublicKey(await readFile(join(inputDir,"public-key.pem")));
 assert.equal(publicKey.asymmetricKeyType,"ed25519");
 assert.equal(edVerify(null,payloadBytes,publicKey,signature),true);
 const source=JSON.parse(payloadBytes.toString("utf8"));
 assert.equal(JSON.stringify(source),payloadBytes.toString("utf8"));
 assert.equal(source.audience,"modo-static-renderer-synthetic-ci-v1");
 assert.equal(source.totalFrames,150);
 assert.equal(source.width,1080);assert.equal(source.height,1920);
 assert.equal(source.fps,30);
 assert.deepEqual(source.scenes.map(x=>[x.startFrame,x.endFrame]),
  [[0,31],[31,95],[95,150]]);
 const {stdout:ffprobeOut}=await run("/usr/bin/ffprobe",[
  "-v","error","-show_streams","-of","json",video
 ],{timeout:12000,maxBuffer:50000});
 const probe=JSON.parse(ffprobeOut);
 assert.equal(probe.streams.length,1);
 assert.equal(probe.streams[0].codec_type,"video");
 assert.equal(probe.streams[0].codec_name,"h264");
 const inputProps={
  brandName:source.brandName,
  title:"Synthetic-only visual divergence audit",
  accentColor:source.accentColor,
  captions:true,
  scenes:source.scenes.map((s,i)=>({
   index:i+1,startFrame:s.startFrame,endFrame:s.endFrame,
   headline:s.headline,caption:s.caption,
   visual:"synthetic-native-static-no-customer-asset",
   visualType:"kinetic_text",imageUrl:null,videoUrl:null,
   motion:"static",transition:"cut",assetRevision:0,audioUrl:null
  }))
 };
 const entryPoint=fileURLToPath(new URL(
  "../../apps/api/src/video-remotion-entry.ts",import.meta.url));
 const serveUrl=await bundle({entryPoint,webpackOverride:config=>({
  ...config,resolve:{...config.resolve,extensionAlias:{
   ...config.resolve?.extensionAlias,".js":[".ts",".tsx",".js"]
  }}
 })});
 const composition=await selectComposition({
  serveUrl,id:"ModoVideo15",inputProps
 });
 // This is a true source distinction, not an inferred difference:
 assert.equal(composition.width,720);
 assert.equal(composition.height,1280);
 assert.equal(composition.fps,30);
 const sampledFrames=[8,43,104]; // interior frames of the three source scenes
 const metrics=[];
 for(const [i,frame] of sampledFrames.entries()){
  const remotion=join(workdir,"remotion-"+i+".png");
  const hyper=join(workdir,"hyperframes-"+i+".png");
  await renderStill({
   composition,serveUrl,frame,inputProps,output:remotion,
   imageFormat:"png",logLevel:"error"
  });
  await ff([
   "-hide_banner","-loglevel","error","-nostdin","-i",video,
   "-vf", "select=eq(n\\,"+frame+"),scale=720:1280:flags=bicubic",
   "-vsync","0","-frames:v","1","-y",hyper
  ]);
  const [rem,hm]=await Promise.all([readFile(remotion),readFile(hyper)]);
  assert.ok(rem.length>1000&&hm.length>1000);
  const observed=await ff([
   "-hide_banner","-nostdin","-i",remotion,"-i",hyper,
   "-filter_complex","[0:v][1:v]ssim",
   "-f","null","-"
  ]);
  const match=/All:\s*([0-9.]+)/.exec(observed);
  assert.ok(match,"HF_REMOTION_PARITY_METRIC_UNAVAILABLE");
  const ssim=Number(match[1]);
  assert.ok(Number.isFinite(ssim)&&ssim>=0&&ssim<=1);
  metrics.push({frame,scene:i+1,ssim:Math.round(ssim*1000000)/1000000,
   remotionStillSha256:sha(rem),hyperframesStillSha256:sha(hm)});
 }
 const meanSSIM=metrics.reduce((a,x)=>a+x.ssim,0)/metrics.length;
 // A recorded divergence must never be silently promoted as visual parity.
 assert.ok(meanSSIM<0.999999,
  "HF_REMOTION_PARITY_EXPECTED_DIFFERENCE_NOT_OBSERVED");
 const result={
  passed:true,syntheticOnly:true,source:"real-Remotion-renderStill-and-real-HyperFrames-H264",
  verdict:"NOT_VISUALLY_EQUIVALENT",equivalenceApproved:false,
  releaseAllowed:false,publicationAllowed:false,
  originalRemotionDimensions:[720,1280],
  originalHyperframesDimensions:[1080,1920],
  normalizedForComparison:[720,1280],
  remotionHasSoundtrack:true,hyperframesHasAudio:false,
  reasons:["Different visual profile, gradient, typography and animation",
   "Remotion always includes generated soundtrack; HyperFrames proof is silent",
   "Remotion composition is 720x1280, pilot exports 1080x1920",
   "Screenshots compare scene interior only, not full video/transition semantics"],
  meanSSIM:Math.round(meanSSIM*1000000)/1000000,
  frames:metrics,videoSha256:sha(videoBytes),
  noProduction:true,noCustomerAssets:true
 };
 await writeFile(join(workdir,"audit-report.json"),
  JSON.stringify(result),{flag:"wx",mode:0o600});
 process.stdout.write(JSON.stringify(result)+"\n");
 completed=true;
}finally{
 await rm(workdir,{recursive:true,force:true});
}
if(!completed)throw Error("HF_REMOTION_PARITY_AUDIT_FAILED");
