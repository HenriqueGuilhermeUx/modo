import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||10000;
const theme={purple:'241239',blue:'092d58',dark:'171923',green:'123c35'};
let busy=false, last=0, ready=false;
const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const send=(res,status,text,kind='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':kind,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text)};
function valid(s,max){return typeof s==='string' && s.length<=max && !/[\u0000-\u001f\u007f]/.test(s) && !/[<>]/.test(s)}
function render(args,timeout=60000){return new Promise((resolve,reject)=>{const p=spawn('/usr/bin/ffmpeg',args,{stdio:['ignore','ignore','pipe']});let err='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(Error('timeout'))},timeout);p.stderr.on('data',b=>{if(err.length<2000)err+=String(b).slice(0,2000-err.length)});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('ffmpeg failed'))})})}
const srv=http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/health')return send(res,ready?200:503,JSON.stringify({ok:ready,engine:'ffmpeg-text-pilot',commercial:false}),'application/json');
  if(!ready && !(req.url==='/api/render' && req.headers['x-modo-startup-check']==='local-fixture' && req.socket.remoteAddress?.includes('127.0.0.1')))return send(res,503,'Starting');
  if(req.method==='GET' && (req.url==='/'||req.url==='/index.html'))return send(res,200,await readFile(path.join(dir,'index.html')),'text/html; charset=utf-8');
  if(req.url!=='/api/render'||req.method!=='POST')return send(res,404,'Not found');
  if(busy||Date.now()-last<1500)return send(res,429,'Busy');
  const chunks=[];let size=0;try{for await(const part of req){size+=part.length;if(size>2048)throw Error('too big');chunks.push(part)}}catch{return send(res,413,'Payload too large')}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(res,400,'Bad JSON')}
  if(!data||!valid(data.title,64)||data.title.length===0||!valid(data.subtitle,80)||!valid(data.scene2??data.subtitle,80)||!valid(data.scene3??data.title,64)||!Object.hasOwn(theme,data.theme)||!['clean','frame','spotlight'].includes(data.style??'clean'))return send(res,400,'Invalid input');
  busy=true;last=Date.now();let tmp;
  try{
    tmp=await mkdtemp(path.join(os.tmpdir(),'modo-video-'));
    const title=path.join(tmp,'title.txt'),subtitle=path.join(tmp,'subtitle.txt'),closing=path.join(tmp,'closing.txt'),file=path.join(tmp,'out.mp4');
    await Promise.all([writeFile(title,data.title,{mode:0o600}),writeFile(subtitle,data.scene2??data.subtitle,{mode:0o600}),writeFile(closing,data.scene3??data.title,{mode:0o600})]);
    const escape=(s)=>s.replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","\\'");
    // Three timed scenes, one fixed 5-second output. Text is supplied
    // exclusively through temporary files; untrusted text never enters a filter expression.
    const filters=[
      'drawbox=x=0:y=0:w=iw:h=16:color=0xa58cff@0.95:t=fill',
      ...(data.style==='frame'?[
        'drawbox=x=44:y=190:w=632:h=900:color=0xa58cff@0.8:t=6',
        'drawbox=x=70:y=225:w=580:h=6:color=white@0.4:t=fill'
      ]:data.style==='spotlight'?[
        'drawbox=x=0:y=440:w=iw:h=420:color=black@0.35:t=fill',
        'drawbox=x=95:y=500:w=530:h=7:color=0xa58cff@0.9:t=fill'
      ]:[]),
      'drawtext=fontfile='+font+':textfile='+escape(title)+':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=590:fix_bounds=1:enable=between(t\\,0\\,1.65)',
      'drawtext=fontfile='+font+':textfile='+escape(subtitle)+':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=610:fix_bounds=1:enable=between(t\\,1.65\\,3.35)',
      'drawtext=fontfile='+font+':textfile='+escape(closing)+':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=555:fix_bounds=1:enable=gte(t\\,3.35)',
      'drawtext=fontfile='+font+':textfile='+escape(subtitle)+':fontcolor=white@0.85:fontsize=22:x=(w-text_w)/2:y=665:fix_bounds=1:enable=gte(t\\,3.35)',
      'fade=t=in:st=0:d=0.25','fade=t=out:st=4.65:d=0.35'
    ].join(',');
    await render(['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=0x'+theme[data.theme]+':s=720x1280:r=24:d=5','-vf',filters,'-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-t','5','-movflags','+faststart','-y',file]);
    const info=await stat(file);if(info.size<2000||info.size>12_000_000)throw Error('bad video');
    const video=await readFile(file);
    res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':video.length,'Content-Disposition':'attachment; filename="modo-video.mp4"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(video);
  }catch{send(res,503,'Rendering unavailable')}finally{busy=false;if(tmp)await rm(tmp,{recursive:true,force:true}).catch(()=>{})}
});
srv.requestTimeout=120000;
srv.listen(port,'0.0.0.0',async()=>{
  console.log('MODO video lab listening',port);
  try {
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),100000);
    let response;
    try {
      response=await fetch('http://127.0.0.1:'+port+'/api/render',{
        method:'POST',signal:ctrl.signal,
        headers:{'content-type':'application/json','x-modo-startup-check':'local-fixture'},
        body:JSON.stringify({title:'Abertura',scene2:'Mensagem principal',scene3:'Encerramento',subtitle:'Video Lab',theme:'purple',style:'frame'})
      });
      if(!response.ok)throw Error('render http '+response.status);
      const video=Buffer.from(await response.arrayBuffer());
      if(video.length<3000||video.length>12000000||video.toString('ascii',4,8)!=='ftyp')throw Error('MP4 invalid');
      ready=true;
      console.log('MODO_STARTUP_MP4_PASS',video.length);
    } finally {clearTimeout(timer)}
  } catch(err) {
    console.error('MODO_STARTUP_MP4_FAIL',err instanceof Error?err.message:'unknown');
    process.exitCode=1;
    srv.close(()=>process.exit(1));
  }
});
