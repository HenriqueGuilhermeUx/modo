/**
 * Trusted disposable-CI signer. Private Ed25519 key is generated in memory,
 * NEVER serialized, mounted into Docker or committed to GitHub.
 * It constructs the order from MODO's real fail-closed VideoProject exporter.
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildStaticStoryboardPlan } from "../../apps/api/dist/services/hyperframes-static-storyboard.js";

if (process.env.NODE_ENV === "production" ||
    process.env.MODO_HF_STATIC_SIGN_FIXTURE !== "synthetic-ci-only" ||
    process.argv.length !== 3 ||
    !process.argv[2].startsWith("/")) {
  throw new Error("HF_STATIC_SIGNER_DISABLED");
}
const directory=resolve(process.argv[2]);
const endpoints=[[0,31],[31,95],[95,150]];
const headlines=["Primeira cena sintética","Segunda cena sintética","Terceira cena sintética"];
const project={
  id:randomUUID(),
  organizationId:"disposable-synthetic-only",
  durationSeconds:5,aspectRatio:"9:16",fps:30,
  voiceover:false,voiceProvider:null,
  scenes:endpoints.map(([startFrame,endFrame],i)=>({
    index:i+1,startFrame,endFrame,headline:headlines[i],
    caption:"Quadros "+startFrame+" a "+(endFrame-1),
    visualType:"kinetic_text",assetSource:"native",
    motion:"static",transition:"cut",imageUrl:null,videoUrl:null,
  })),
};
const plan=buildStaticStoryboardPlan(project,"Marca Sintética");
if(plan.totalFrames!==150 || plan.scenes.map(x=>x.frames).join(",")!=="31,64,55" ||
   plan.publishingAllowed!==false || plan.previewOnly!==true) {
  throw Error("HF_STATIC_SIGNER_BAD_MODO_PLAN");
}
const issued=Date.now();
const payload={
  version:1,
  audience:"modo-static-renderer-synthetic-ci-v1",
  issuedAtMs:issued,
  expiresAtMs:issued+300_000,
  jobId:"synthetic-"+randomUUID(),
  brandName:"Marca Sintética",
  accentColor:"#2ED19A",
  width:plan.width,
  height:plan.height,
  fps:plan.fps,
  totalFrames:plan.totalFrames,
  scenes:plan.scenes.map(x=>({
    startFrame:x.startFrame,endFrame:x.endFrame,
    headline:x.headline,caption:x.caption,
  })),
};
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
function envelope(data){
  const bytes=Buffer.from(JSON.stringify(data));
  return {payloadB64:bytes.toString("base64url"),
    signatureB64:sign(null,bytes,privateKey).toString("base64url")};
}
const order=envelope(payload);
const tampered={...order,signatureB64:
  (order.signatureB64[0]==="A"?"B":"A")+order.signatureB64.slice(1)};
const expired=envelope({...payload,issuedAtMs:issued-120_000,
  expiresAtMs:issued-1_000});
await mkdir(directory,{recursive:true,mode:0o755});
await Promise.all([
  writeFile(resolve(directory,"order.json"),JSON.stringify(order),{mode:0o644,flag:"wx"}),
  writeFile(resolve(directory,"tampered.json"),JSON.stringify(tampered),{mode:0o644,flag:"wx"}),
  writeFile(resolve(directory,"expired.json"),JSON.stringify(expired),{mode:0o644,flag:"wx"}),
  writeFile(resolve(directory,"public-key.pem"),
    publicKey.export({format:"pem",type:"spki"}),{mode:0o644,flag:"wx"}),
]);
process.stdout.write("Signed synthetic-only MODO order created. "+
  "Private key never written, no customer metadata.\n");
