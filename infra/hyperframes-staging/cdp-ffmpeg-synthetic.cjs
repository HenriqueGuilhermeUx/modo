"use strict";
/* Synthetic offline feasibility test ONLY: no customer input or public API.
   Proves a Chrome CDP localhost capture -> FFmpeg H264 video in the
   same restricted Docker sandbox. This does NOT replace HyperFrames CLI. */
const crypto = require("node:crypto");
const cp = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const puppeteer = require("/opt/hyperframes/node_modules/puppeteer-core");
const exec = util.promisify(cp.execFile);
const browserExecutable = "/usr/local/bin/hf-chrome";
const allow = () => {
  if (process.env.NODE_ENV === "production" ||
      process.env.MODO_HF_SYNTHETIC_CI !== "only-fixture" ||
      process.env.HYPERFRAMES_BROWSER_PATH !== browserExecutable ||
      process.getuid?.() !== 10001 || process.argv.length !== 2) {
    throw Error("HF_CDP_FFMPEG_DISABLED");
  }
};
async function bounded(promise, ms, name) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(name)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function main() {
  allow();
  const html = await fs.readFile("/fixtures/index.html", "utf8");
  if (Buffer.byteLength(html) > 16384 ||
      !html.includes("Composição sintética") ||
      !html.includes("Smoke test isolado")) throw Error("HF_CDP_FFMPEG_FIXTURE_INVALID");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-synthetic-cdp-"));
  let server, browser;
  try {
    server = http.createServer((req, res) => {
      if (req.method !== "GET" || req.url !== "/fixture") {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'",
      });
      res.end(html);
    });
    await bounded(new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    }), 4000, "HF_CDP_FFMPEG_LISTEN_TIMEOUT");
    browser = await bounded(puppeteer.launch({
      executablePath: browserExecutable, headless: true,
      protocolTimeout: 8000, timeout: 12000,
      args: ["--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-background-networking",
        "--no-first-run", "--disable-extensions"],
    }), 15000, "HF_CDP_FFMPEG_LAUNCH_TIMEOUT");
    const page = await bounded(browser.newPage(), 8000, "HF_CDP_FFMPEG_PAGE_TIMEOUT");
    await page.setViewport({width:1080, height:1920, deviceScaleFactor:1});
    const session = await bounded(page.createCDPSession(), 4000, "HF_CDP_FFMPEG_SESSION_TIMEOUT");
    await bounded(session.send("Network.enable"), 5000, "HF_CDP_FFMPEG_NETWORK_TIMEOUT");
    await bounded(page.goto("http://127.0.0.1:" + server.address().port + "/fixture",
      {waitUntil:"load", timeout:8000}), 9000, "HF_CDP_FFMPEG_HTTP_TIMEOUT");
    const layout = await page.evaluate(() => {
      const el = document.querySelector("#root");
      return {width:el?.getBoundingClientRect().width,
        height:el?.getBoundingClientRect().height, text:el?.textContent || ""};
    });
    if (layout.width !== 1080 || layout.height !== 1920 ||
        !layout.text.includes("Composição sintética")) throw Error("HF_CDP_FFMPEG_LAYOUT_INVALID");
    const first = await bounded(page.screenshot({type:"png",path:path.join(dir,"first.png")}),
      10000, "HF_CDP_FFMPEG_FRAME1_TIMEOUT");
    await page.evaluate(() => { document.querySelector("h1").textContent = "Segundo quadro sintético"; });
    const second = await bounded(page.screenshot({type:"png",path:path.join(dir,"second.png")}),
      10000, "HF_CDP_FFMPEG_FRAME2_TIMEOUT");
    if (first.length < 2000 || second.length < 2000 ||
        crypto.createHash("sha256").update(first).digest("hex") ===
        crypto.createHash("sha256").update(second).digest("hex")) {
      throw Error("HF_CDP_FFMPEG_FRAMES_UNCHANGED");
    }
    await bounded(page.close(), 4000, "HF_CDP_FFMPEG_PAGE_CLOSE_TIMEOUT");
    await bounded(browser.close(), 4000, "HF_CDP_FFMPEG_BROWSER_CLOSE_TIMEOUT");
    browser = null;
    server.closeAllConnections();
    await bounded(new Promise(resolve => server.close(resolve)),
      4000, "HF_CDP_FFMPEG_SERVER_CLOSE_TIMEOUT");
    server = null;
    const out = path.join(dir, "synthetic.mp4");
    await exec("/usr/bin/ffmpeg", [
      "-hide_banner","-loglevel","error","-nostdin",
      "-loop","1","-framerate","30","-t","1","-i",path.join(dir,"first.png"),
      "-loop","1","-framerate","30","-t","1","-i",path.join(dir,"second.png"),
      "-filter_complex","[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
      "-map","[v]","-c:v","libx264","-preset","veryfast","-crf","28",
      "-r","30","-movflags","+faststart","-y",out,
    ], {timeout:60000,maxBuffer:8192});
    const {stdout} = await exec("/usr/bin/ffprobe",[
      "-v","error","-select_streams","v:0","-show_entries",
      "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration",
      "-of","json",out],{timeout:10000,maxBuffer:8192});
    const details = JSON.parse(stdout), stream = details.streams?.[0];
    const seconds = Number(details.format?.duration), bytes = (await fs.stat(out)).size;
    if (details.streams?.length !== 1 || stream.codec_name !== "h264" ||
        stream.width !== 1080 || stream.height !== 1920 ||
        stream.r_frame_rate !== "30/1" || Number(stream.nb_frames) !== 60 ||
        !Number.isFinite(seconds) || Math.abs(seconds-2)>0.1 ||
        bytes < 6000 || bytes > 25_000_000) throw Error("HF_CDP_FFMPEG_BAD_MP4");
    const video = await fs.readFile(out);
    if(video.toString("ascii",4,8)!=="ftyp") throw Error("HF_CDP_FFMPEG_BAD_CONTAINER");
    process.stdout.write(JSON.stringify({
      result:"pass", engine:"direct-cdp-ffmpeg-not-hyperframes",
      synthetic:true, offline:true, h264:true, width:1080,
      height:1920, fps:30, frames:60, duration:2, bytes,
    })+"\n");
  } finally {
    if(browser) await bounded(browser.close(),2000,"HF_CDP_FFMPEG_CLEANUP")
      .catch(()=>browser.process()?.kill("SIGKILL"));
    if(server){server.closeAllConnections();server.close();}
    await fs.rm(dir,{recursive:true,force:true});
  }
}
void main().catch(err=>{
  const safe=err instanceof Error && /^HF_CDP_FFMPEG_[A-Z0-9_]+$/.test(err.message)
    ? err.message : "HF_CDP_FFMPEG_FAILURE";
  process.stderr.write(safe+"\n");
  process.exitCode=1;
});
