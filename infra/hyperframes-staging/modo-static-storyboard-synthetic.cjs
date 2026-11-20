"use strict";
/**
 * SYNTHETIC-ONLY experimental MODO static-text storyboard parity gate.
 * Uses the same compiled MODO VideoProject validator/exporter as the API.
 * Browser+FFmpeg cannot access database, UNIX DB socket, signing keys or
 * original customer assets. NOT for customer content or production.
 */
const crypto = require("node:crypto");
const cp = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const puppeteer = require("/opt/hyperframes/node_modules/puppeteer-core");
const exec = util.promisify(cp.execFile);
const BROWSER = "/usr/local/bin/hf-chrome";
const FPS = 30;
const MAX_SECONDS = 12;

function gate() {
  if (process.argv.length !== 2 ||
      process.env.MODO_HF_STATIC_STORYBOARD_CI !== "synthetic-only" ||
      process.env.NODE_ENV === "production" ||
      process.getuid?.() !== 10001 ||
      process.env.HYPERFRAMES_BROWSER_PATH !== BROWSER) {
    throw Error("HF_STATIC_CI_NOT_ENABLED");
  }
  const blockedEnv = /^(?:PG(?:HOST|PORT|USER|PASSWORD|DATABASE)|DATABASE_URL|MODO_HYPERFRAMES_(?:CONTENT|SIGNING)_KEY_B64|MODO_HYPERFRAMES_STAGE_DB_|HF_STAGE_)/;
  if (Object.keys(process.env).some(key => blockedEnv.test(key)) ||
      fsSync.existsSync("/run/hyperframes/order.json") ||
      fsSync.existsSync("/run/hyperframes/db-password") ||
      fsSync.existsSync("/var/run/postgresql/.s.PGSQL.5432")) {
    throw Error("HF_STATIC_CI_DB_OR_SECRET_EXPOSED");
  }
}

async function deadline(promise, ms, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(code)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function sampleProject() {
  const endpoints = [[0,31],[31,95],[95,150]];
  const headlines = [
    "Primeira cena sintética",
    "Segunda cena sintética",
    "Terceira cena sintética",
  ];
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "fake-organization-for-fixture",
    durationSeconds: 5, aspectRatio: "9:16", fps: FPS,
    voiceover: false, voiceProvider: null,
    scenes: endpoints.map(([startFrame,endFrame],index)=>({
      index:index+1, startFrame, endFrame,
      headline:headlines[index],
      caption: "Quadros " + startFrame + " a " + (endFrame-1),
      visualType:"kinetic_text", assetSource:"native", motion:"static",
      transition:"cut", imageUrl:null, videoUrl:null,
    })),
  };
}

async function main() {
  gate();
  // Import ONLY the pure, compiled MODO authoring/validation modules.
  const {buildStaticStoryboardPlan} = await import(
    "/app/apps/api/dist/services/hyperframes-static-storyboard.js");
  const plan = buildStaticStoryboardPlan(sampleProject(), "Marca Sintética");
  if (plan.totalFrames !== 150 || plan.scenes.length !== 3 ||
      plan.width !== 1080 || plan.height !== 1920 || plan.fps !== FPS ||
      plan.publishingAllowed !== false || plan.previewOnly !== true ||
      plan.scenes.reduce((acc,s)=>acc+s.frames,0)!==150 ||
      plan.scenes.map(s=>s.frames).join(",")!=="31,64,55" ||
      !/^[a-f0-9]{64}$/.test(plan.planSha256)) {
    throw Error("HF_STATIC_CI_INVALID_VALIDATED_PLAN");
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(),"hf-static-storyboard-"));
  let server, browser;
  try {
    server = http.createServer((req,res)=>{
      if(req.method!=="GET" || req.url!=="/composition"){
        res.writeHead(404);res.end();return;
      }
      res.writeHead(200,{
        "Content-Type":"text/html; charset=utf-8",
        "Cache-Control":"no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'",
      });
      res.end(plan.html);
    });
    await deadline(new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",resolve);
    }),3000,"HF_STATIC_CI_LISTEN_TIMEOUT");
    browser = await deadline(puppeteer.launch({
      executablePath:BROWSER,headless:true,timeout:15000,protocolTimeout:8000,
      args:["--no-sandbox","--disable-setuid-sandbox",
        "--disable-dev-shm-usage","--disable-background-networking",
        "--no-first-run","--disable-extensions"],
    }),16000,"HF_STATIC_CI_BROWSER_TIMEOUT");
    const page = await deadline(browser.newPage(),8000,"HF_STATIC_CI_PAGE_TIMEOUT");
    await page.setViewport({width:1080,height:1920,deviceScaleFactor:1});
    const cdp = await deadline(page.createCDPSession(),4000,"HF_STATIC_CI_SESSION_TIMEOUT");
    await deadline(cdp.send("Network.enable"),5000,"HF_STATIC_CI_CDP_TIMEOUT");
    await deadline(page.goto("http://127.0.0.1:"+server.address().port+"/composition",
      {waitUntil:"load",timeout:8000}),9000,"HF_STATIC_CI_HTTP_TIMEOUT");

    const paths = [], imageDigests = [];
    for(let i=0;i<plan.scenes.length;i++){
      const scene=plan.scenes[i], idx=i;
      // Pure static cut selection. Never run project JS, remote requests,
      // assets, CSS animations or a time-seeking engine in this pilot.
      const visible=await deadline(page.evaluate(({index,width,height})=>{
        const root=document.querySelector("#root");
        const clips=[...document.querySelectorAll("#root > section")];
        if(!root||clips.length!==3) return null;
        root.style.width=width+"px";
        root.style.height=height+"px";
        clips.forEach((clip,n)=>{
          clip.style.display=n===index?"flex":"none";
          clip.setAttribute("aria-hidden",n===index?"false":"true");
        });
        const chosen=clips[index];
        return {
          heading:chosen.querySelector("h1")?.textContent,
          caption:chosen.querySelector("p")?.textContent,
          active:clips.filter(el=>getComputedStyle(el).display!=="none").length,
          width:root.getBoundingClientRect().width,
          height:root.getBoundingClientRect().height,
        };
      },{index:idx,width:plan.width,height:plan.height}),5000,"HF_STATIC_CI_SCENE_SELECT_TIMEOUT");
      if(!visible || visible.heading!==scene.headline ||
          visible.caption!==scene.caption || visible.active!==1 ||
          visible.width!==1080 || visible.height!==1920){
        throw Error("HF_STATIC_CI_SCENE_PARITY_FAILED");
      }
      const filename=path.join(scratch,"scene-"+(i+1)+".png");
      const png=await deadline(page.screenshot({path:filename,type:"png"}),
        12000,"HF_STATIC_CI_SCREENSHOT_TIMEOUT");
      if(png.length<2000)throw Error("HF_STATIC_CI_EMPTY_FRAME");
      paths.push(filename);
      imageDigests.push(crypto.createHash("sha256").update(png).digest("hex"));
    }
    if(new Set(imageDigests).size!==plan.scenes.length){
      throw Error("HF_STATIC_CI_MISSING_SCENE_CUT");
    }
    await deadline(page.close(),3000,"HF_STATIC_CI_PAGE_CLOSE_TIMEOUT");
    await deadline(browser.close(),3000,"HF_STATIC_CI_BROWSER_CLOSE_TIMEOUT");
    browser=null;
    server.closeAllConnections();
    await deadline(new Promise(resolve=>server.close(resolve)),
      3000,"HF_STATIC_CI_SERVER_CLOSE_TIMEOUT");
    server=null;

    const video=path.join(scratch,"storyboard-synthetic.mp4");
    const args=["-hide_banner","-loglevel","error","-nostdin"];
    for(let i=0;i<paths.length;i++){
      const scene=plan.scenes[i];
      const duration=(scene.frames/FPS).toFixed(7);
      args.push("-loop","1","-framerate","30","-t",duration,"-i",paths[i]);
    }
    const sources=paths.map((_,i)=>"["+i+":v]").join("");
    args.push("-filter_complex",sources+"concat=n="+paths.length+":v=1:a=0,format=yuv420p[v]",
      "-map","[v]","-c:v","libx264","-preset","veryfast",
      "-crf","28","-r","30","-movflags","+faststart","-y",video);
    await exec("/usr/bin/ffmpeg",args,{timeout:60000,maxBuffer:8192});
    const {stdout}=await exec("/usr/bin/ffprobe",[
      "-v","error","-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration",
      "-of","json",video,
    ],{timeout:10000,maxBuffer:8192});
    const details=JSON.parse(stdout), v=details.streams?.[0];
    const duration=Number(details.format?.duration);
    const size=(await fs.stat(video)).size;
    if(details.streams?.length!==1 || v.codec_type!=="video" ||
        v.codec_name!=="h264" || v.width!==1080 || v.height!==1920 ||
        v.r_frame_rate!=="30/1" || Number(v.nb_frames)!==plan.totalFrames ||
        !Number.isFinite(duration) || Math.abs(duration-5)>0.05 ||
        size<6000 || size>25000000)throw Error("HF_STATIC_CI_INVALID_VIDEO");
    const result=await fs.readFile(video);
    if(result.toString("ascii",4,8)!=="ftyp")throw Error("HF_STATIC_CI_INVALID_MP4");
    process.stdout.write(JSON.stringify({
      result:"pass",engine:"modo-static-cdp-ffmpeg-synthetic-only",
      noDatabaseSecrets:true,offline:true,published:false,
      scenes:plan.scenes.length,sceneFrames:plan.scenes.map(s=>s.frames),
      totalFrames:plan.totalFrames,seconds:5,fps:30,
      width:1080,height:1920,codec:"h264",bytes:size,
      planDigest:plan.planSha256,
    })+"\n");
  } finally {
    if(browser)await deadline(browser.close(),2000,"HF_STATIC_CI_BROWSER_CLEANUP")
      .catch(()=>browser.process()?.kill("SIGKILL"));
    if(server){server.closeAllConnections();server.close();}
    await fs.rm(scratch,{recursive:true,force:true});
  }
}
void main().catch(error=>{
  const code=error instanceof Error && /^HF_STATIC_CI_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "HF_STATIC_CI_FAILED";
  process.stderr.write(code+"\n");
  process.exitCode=1;
});
