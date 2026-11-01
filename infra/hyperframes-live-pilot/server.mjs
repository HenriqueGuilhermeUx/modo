import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||10000;
const theme={purple:'241239',blue:'092d58',dark:'171923',green:'123c35'};
let busy=false, last=0;
const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const send=(res,status,text,kind='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':kind,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text)};
function valid(s,max){return typeof s==='string' && s.length<=max && !/[\u0000-\u001f\u007f]/.test(s) && !/[<>]/.test(s)}
function render(args,timeout=60000){return new Promise((resolve,reject)=>{const p=spawn('/usr/bin/ffmpeg',args,{stdio:['ignore','ignore','pipe']});let err='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('timeout'))},timeout);p.stderr.on('data',b=>{if(err.length<2000)err+=String(b).slice(0,2000-err.length)});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('ffmpeg failed'))})})}
const srv=http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/health')return send(res,200,JSON.stringify({ok:true,engine:'ffmpeg-text-pilot',commercial:false}),'application/json');
  if(req.method==='GET' && (req.url==='/'||req.url==='/index.html'))return send(res,200,await readFile(path.join(dir,'index.html')),'text/html; charset=utf-8');
  if(req.url!=='/api/render'||req.method!=='POST')return send(res,404,'Not found');
  if(busy||Date.now()-last<1500)return send(res,429,'Busy');
  const chunks=[];let size=0;try{for await(const part of req){size+=part.length;if(size>2048)throw Error('too big');chunks.push(part)}}catch{return send(res,413,'Payload too large')}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(res,400,'Bad JSON')}
  if(!data||!valid(data.title,64)||data.title.length===0||!valid(data.subtitle,80)||!Object.hasOwn(theme,data.theme))return send(res,400,'Invalid input');
  busy=true;last=Date.now();let tmp;
  try{
    tmp=await mkdtemp(path.join(os.tmpdir(),'modo-video-'));
    const title=path.join(tmp,'title.txt'),subtitle=path.join(tmp,'subtitle.txt'),file=path.join(tmp,'out.mp4');
    await Promise.all([writeFile(title,data.title,{mode:0o600}),writeFile(subtitle,data.subtitle,{mode:0o600})]);
    const escape=(s)=>s.replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","\\'");
    const filters=[
      'drawtext=fontfile='+font+':textfile='+escape(title)+':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=580:fix_bounds=1',
      'drawtext=fontfile='+font+':textfile='+escape(subtitle)+':fontcolor=white@0.85:fontsize=23:x=(w-text_w)/2:y=690:fix_bounds=1'
    ].join(',');
    await render(['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=0x'+theme[data.theme]+':s=720x1280:r=24:d=5','-vf',filters,'-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-t','5','-movflags','+faststart','-y',file]);
    const info=await stat(file);if(info.size<2000||info.size>12_000_000)throw Error('bad video');
    const video=await readFile(file);
    res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':video.length,'Content-Disposition':'attachment; filename="modo-video.mp4"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(video);
  }catch{send(res,503,'Rendering unavailable')}finally{busy=false;if(tmp)await rm(tmp,{recursive:true,force:true}).catch(()=>{})}
});
srv.requestTimeout=120000;srv.listen(port,'0.0.0.0',()=>console.log('MODO video lab listening',port));
