"use strict";
/**
 * Independent, SYNTHETIC-ONLY, signed static-text renderer. There is no
 * database adapter, API process, customer asset loader, media publisher or
 * signing private key in this image. Do not enable for customer HTML.
 */
const crypto = require("node:crypto");
const cp = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const puppeteer = require("/opt/static-browser/node_modules/puppeteer-core");
const exec = promisify(cp.execFile);
const BROWSER = "/usr/local/bin/hf-static-chrome";
const AUDIENCE = "modo-static-renderer-synthetic-ci-v1";
const PAYLOAD_KEYS = ["version","audience","issuedAtMs","expiresAtMs","jobId","brandName","accentColor","width","height","fps","totalFrames","scenes"];
const SCENE_KEYS = ["startFrame","endFrame","headline","caption"];
const MAX_FRAMES = 360; // synthetic 12s maximum; fail closed for this pilot

function denial(code) { throw Error("HF_STATIC_RENDERER_" + code); }
function hasExactKeys(value, keys) {
  return value && !Array.isArray(value) && typeof value === "object" &&
    Object.keys(value).length === keys.length &&
    keys.every(k => Object.prototype.hasOwnProperty.call(value,k));
}
function allowedText(text, max, nonempty) {
  return typeof text === "string" && text.length <= max &&
    (!nonempty || !!text.trim()) &&
    !/[\u0000-\u001f\u007f]/u.test(text);
}
function validatePayload(p, now) {
  if (!hasExactKeys(p,PAYLOAD_KEYS) ||
      p.version !== 1 || p.audience !== AUDIENCE ||
      !Number.isSafeInteger(p.issuedAtMs) || !Number.isSafeInteger(p.expiresAtMs) ||
      p.issuedAtMs > now + 5_000 || p.issuedAtMs < now - 300_000 ||
      p.expiresAtMs <= now || p.expiresAtMs > p.issuedAtMs + 300_000 ||
      !/^synthetic-[a-z0-9-]{10,70}$/.test(p.jobId) ||
      !allowedText(p.brandName,100,true) ||
      !/^#[0-9a-fA-F]{6}$/.test(p.accentColor) ||
      p.width !== 1080 || p.height !== 1920 || p.fps !== 30 ||
      !Number.isSafeInteger(p.totalFrames) || p.totalFrames < 30 ||
      p.totalFrames > MAX_FRAMES ||
      !Array.isArray(p.scenes) || p.scenes.length < 1 ||
      p.scenes.length > 8) denial("INVALID_ORDER");
  let current=0;
  for(const scene of p.scenes) {
    if (!hasExactKeys(scene,SCENE_KEYS) ||
        !Number.isSafeInteger(scene.startFrame) ||
        !Number.isSafeInteger(scene.endFrame) ||
        scene.startFrame !== current || scene.endFrame <= current ||
        scene.endFrame-scene.startFrame < 30 ||
        scene.endFrame-scene.startFrame > 360 ||
        !allowedText(scene.headline,180,true) ||
        !allowedText(scene.caption,280,false)) denial("INVALID_TIMELINE");
    current=scene.endFrame;
  }
  if(current !== p.totalFrames) denial("INVALID_TIMELINE");
  return p;
}
function failClosedEnvironment() {
  if(process.argv.length !== 3 ||
     process.argv[2] !== "/input/order.json" ||
     process.getuid?.() !== 10001 ||
     process.env.NODE_ENV === "production" ||
     process.env.MODO_HF_STATIC_RENDERER_MODE !== "synthetic-ci-only") {
    denial("DISABLED");
  }
  const banned = /^(?:PG(?:HOST|PORT|USER|PASSWORD|DATABASE)|DATABASE_URL|.*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CONTENT_KEY|SIGNING_KEY)|HF_STAGE_)/;
  if (Object.keys(process.env).some(x=>banned.test(x)) ||
      fs.existsSync("/var/run/postgresql/.s.PGSQL.5432") ||
      fs.existsSync("/run/hyperframes/order.json") ||
      fs.existsSync("/run/hyperframes/db-password") ||
      fs.existsSync("/input/private-key.pem") ||
      fs.existsSync("/app/apps/api")) denial("SECRET_BOUNDARY");
}
async function verifyEnvelope() {
  const file = await fsp.readFile("/input/order.json");
  const pubFile = await fsp.readFile("/input/public-key.pem");
  if(file.length > 16_000 || pubFile.length > 1_000 ||
     !fs.statSync("/input/order.json").isFile() ||
     !fs.statSync("/input/public-key.pem").isFile()) denial("BAD_INPUT_FILES");
  let order;
  try { order=JSON.parse(file.toString("utf8")); }
  catch {denial("INVALID_ENVELOPE");}
  if(!hasExactKeys(order,["payloadB64","signatureB64"]) ||
     typeof order.payloadB64 !== "string" ||
     typeof order.signatureB64 !== "string" ||
     !/^[A-Za-z0-9_-]{40,12000}$/.test(order.payloadB64) ||
     !/^[A-Za-z0-9_-]{86}$/.test(order.signatureB64)) denial("INVALID_ENVELOPE");
  const bytes=Buffer.from(order.payloadB64,"base64url");
  const sig=Buffer.from(order.signatureB64,"base64url");
  if(bytes.toString("base64url") !== order.payloadB64 || sig.length!==64 ||
     sig.toString("base64url") !== order.signatureB64) denial("NONCANONICAL_SIGNATURE");
  let key;
  try { key=crypto.createPublicKey(pubFile); }
  catch { denial("INVALID_PUBLIC_KEY"); }
  if(key.asymmetricKeyType !== "ed25519" ||
     !crypto.verify(null,bytes,key,sig)) denial("SIGNATURE_DENIED");
  let payload;
  try { payload=JSON.parse(bytes.toString("utf8")); }
  catch { denial("INVALID_SIGNED_JSON"); }
  if(Buffer.from(JSON.stringify(payload)).equals(bytes)===false) denial("NONCANONICAL_PAYLOAD");
  return validatePayload(payload,Date.now());
}
function escapeHtml(text) {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function htmlFor(p) {
  // Renderer generates markup from signed allowlisted strings; no HTML,
  // JavaScript, remote URLs, CSS, clips or user-controlled paths are accepted.
  const sections=p.scenes.map((s,i)=>
    '<section class="scene" id="scene-'+(i+1)+'" style="display:none">'+
    '<div class="brand">'+escapeHtml(p.brandName)+'</div>'+
    '<h1>'+escapeHtml(s.headline)+'</h1>'+
    '<p>'+escapeHtml(s.caption)+'</p></section>');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#090e17;font-family:Arial,sans-serif}'+
    '#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#090e17;color:white;isolation:isolate}'+
    '.scene{position:absolute;inset:0;width:100%;height:100%;flex-direction:column;justify-content:center;'+
    'align-items:flex-start;padding:9%;gap:3%}'+
    '.brand{color:'+p.accentColor+';font-size:34px;font-weight:800;text-transform:uppercase;letter-spacing:4px}'+
    'h1{font-size:86px;line-height:1.09;margin:0;max-width:95%;overflow-wrap:break-word}'+
    'p{font-size:40px;line-height:1.25;max-width:92%;margin:0;opacity:.85;overflow-wrap:break-word}'+
    '</style></head><body><div id="root">'+sections.join("")+'</div></body></html>';
}
async function limited(promise,ms,code) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error("HF_STATIC_RENDERER_"+code)),ms);
    })]);
  } finally {clearTimeout(timer);}
}
async function render(p) {
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),"modo-static-signed-"));
  let server,browser;
  try {
    const html=htmlFor(p);
    server=http.createServer((req,res)=>{
      if(req.method!=="GET"||req.url!=="/synthetic"){res.writeHead(404);res.end();return;}
      res.writeHead(200,{
        "Content-Type":"text/html; charset=utf-8",
        "Cache-Control":"no-store",
        "Content-Security-Policy":"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'",
      });
      res.end(html);
    });
    await limited(new Promise((resolve,reject)=>{
      server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
    }),4_000,"LOCALHOST_FAILED");
    browser=await limited(puppeteer.launch({
      executablePath:BROWSER,headless:true,protocolTimeout:8_000,timeout:15_000,
      args:["--no-sandbox","--disable-setuid-sandbox",
        "--disable-dev-shm-usage","--disable-background-networking",
        "--no-first-run","--disable-extensions"],
    }),16_000,"CHROME_FAILED");
    const page=await limited(browser.newPage(),8_000,"CDP_PAGE_FAILED");
    await page.setViewport({width:1080,height:1920,deviceScaleFactor:1});
    const session=await limited(page.createCDPSession(),4_000,"CDP_SESSION_FAILED");
    await limited(session.send("Network.enable"),5_000,"CDP_NETWORK_FAILED");
    await limited(page.goto("http://127.0.0.1:"+server.address().port+"/synthetic",
      {waitUntil:"load",timeout:8_000}),9_000,"LOCAL_PAGE_FAILED");
    const paths=[],hashes=[];
    for(let i=0;i<p.scenes.length;i++){
      const chosen=await limited(page.evaluate(({index,total})=>{
        const root=document.querySelector("#root");
        const scenes=[...document.querySelectorAll("#root > section")];
        if(!root || scenes.length!==total) return null;
        for(let n=0;n<scenes.length;n++) scenes[n].style.display=n===index?"flex":"none";
        return {
          headline:scenes[index].querySelector("h1")?.textContent,
          caption:scenes[index].querySelector("p")?.textContent,
          visible:scenes.filter(x=>getComputedStyle(x).display!=="none").length,
          width:root.getBoundingClientRect().width,
          height:root.getBoundingClientRect().height,
        };
      },{index:i,total:p.scenes.length}),6_000,"SCENE_SELECTION_TIMEOUT");
      if(!chosen || chosen.headline!==p.scenes[i].headline ||
         chosen.caption!==p.scenes[i].caption || chosen.visible!==1 ||
         chosen.width!==1080 || chosen.height!==1920)denial("SCENE_PARITY");
      const filepath=path.join(dir,"scene-"+i+".png");
      const shot=await limited(page.screenshot({path:filepath,type:"png"}),12_000,"SCREENSHOT_TIMEOUT");
      if(shot.length<2_000)denial("EMPTY_FRAME");
      paths.push(filepath);
      hashes.push(crypto.createHash("sha256").update(shot).digest("hex"));
    }
    if(new Set(hashes).size!==p.scenes.length)denial("SCENE_NOT_DISTINCT");
    await limited(page.close(),4_000,"PAGE_CLOSE_TIMEOUT");
    await limited(browser.close(),4_000,"CHROME_CLOSE_TIMEOUT");
    browser=null;
    server.closeAllConnections();
    await limited(new Promise(resolve=>server.close(resolve)),4_000,"SERVER_CLOSE_TIMEOUT");
    server=null;

    const video=path.join(dir,"synthetic.mp4"),args=["-hide_banner","-loglevel","error","-nostdin"];
    for(let i=0;i<paths.length;i++) {
      args.push("-loop","1","-framerate","30","-t",
        ((p.scenes[i].endFrame-p.scenes[i].startFrame)/30).toFixed(7),
        "-i",paths[i]);
    }
    args.push("-filter_complex",
      paths.map((_,i)=>"["+i+":v]").join("")+
      "concat=n="+paths.length+":v=1:a=0,format=yuv420p[v]",
      "-map","[v]","-r","30","-c:v","libx264","-preset","veryfast",
      "-crf","28","-movflags","+faststart","-y",video);
    await exec("/usr/bin/ffmpeg",args,{timeout:60_000,maxBuffer:8192});
    const {stdout}=await exec("/usr/bin/ffprobe",[
      "-v","error","-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration",
      "-of","json",video],{timeout:12_000,maxBuffer:8192});
    let info;
    try{info=JSON.parse(stdout);}catch{denial("PROBE_JSON");}
    const stream=info.streams?.[0],duration=Number(info.format?.duration);
    const size=(await fsp.stat(video)).size;
    if(info.streams?.length!==1 || stream.codec_type!=="video" ||
       stream.codec_name!=="h264" || stream.width!==1080 || stream.height!==1920 ||
       stream.r_frame_rate!=="30/1" || Number(stream.nb_frames)!==p.totalFrames ||
       !Number.isFinite(duration) || Math.abs(duration-p.totalFrames/30)>0.05 ||
       size<4000 || size>25_000_000)denial("INVALID_VIDEO");
    const bytes=await fsp.readFile(video);
    if(bytes.toString("ascii",4,8)!=="ftyp")denial("INVALID_MP4");
    process.stdout.write(JSON.stringify({
      passed:true,syntheticOnly:true,standalone:true,authorizedBy:"ed25519",
      noDbRuntime:true,frames:p.totalFrames,
      sceneFrames:p.scenes.map(s=>s.endFrame-s.startFrame),seconds:p.totalFrames/30,
      width:1080,height:1920,codec:"h264",bytes:size,
    })+"\n");
  } finally {
    if(browser)await limited(browser.close(),2_000,"BROWSER_CLEANUP")
      .catch(()=>browser.process()?.kill("SIGKILL"));
    if(server){server.closeAllConnections();server.close();}
    await fsp.rm(dir,{recursive:true,force:true});
  }
}
void (async()=>{failClosedEnvironment();const payload=await verifyEnvelope();await render(payload);})()
  .catch(error=>{
    const code=error instanceof Error &&
      /^HF_STATIC_RENDERER_[A-Z0-9_]+$/.test(error.message)
      ? error.message:"HF_STATIC_RENDERER_FAILED";
    process.stderr.write(code+"\n");
    process.exitCode=1;
  });
