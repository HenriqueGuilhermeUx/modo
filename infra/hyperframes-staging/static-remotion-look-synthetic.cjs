"use strict";
/** Synthetic-only Remotion-inspired layout, never a replacement for commercial Remotion.
 * No untrusted HTML, URLs, custom CSS, audio or media enter the browser. */
function escapeHtml(text){
 return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function generateSyntheticRemotionLook(p){
 if(!p||p.width!==1080||p.height!==1920||p.fps!==30||
  !Array.isArray(p.scenes)||p.scenes.length!==3||
  !/^#[0-9a-fA-F]{6}$/.test(p.accentColor)||
  typeof p.brandName!=="string"||p.brandName.length>100||
  p.scenes.some(s=>typeof s.headline!=="string"||
   typeof s.caption!=="string"))throw Error("HF_STATIC_REMOTION_LOOK_INVALID");
 const accent=p.accentColor;
 const scenes=p.scenes.map((s,i)=>'<section class="scene" id="scene-'+(i+1)+'" style="display:none">'+
  '<div class="native-bg"><span class="native-number">'+String(i+1).padStart(2,"0")+'</span></div>'+
  '<div class="overlay"></div><div class="glow"></div>'+
  '<header><span class="header-mark"></span><strong class="brand">'+
  escapeHtml(p.brandName.slice(0,36))+'</strong><span class="scene-number">'+
  String(i+1).padStart(2,"0")+'</span></header>'+
  '<div class="copy"><div class="eyebrow"><span class="eyebrow-line"></span>'+
  (i===p.scenes.length-1?'<span class="next">PRÓXIMO PASSO</span>':"")+
  '</div><h1>'+escapeHtml(s.headline)+'</h1><p>'+escapeHtml(s.caption)+
  '</p></div><div class="caption">'+escapeHtml(s.caption)+
  '</div><div class="progress"></div></section>').join("");
 // Remotion dynamic kinetic-text profile measured at original 720x1280
 // and uniformly scaled to signed 1080x1920 output. The static renderer
 // still captures ONE frame per scene: motion parity is NOT established.
 const css=[
  '*{box-sizing:border-box}html,body{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:#0D1B3E;font-family:Arial,sans-serif}',
  '#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#0D1B3E;color:white;isolation:isolate}',
  '#logical{position:absolute;top:0;left:0;width:720px;height:1280px;transform:scale(1.5);transform-origin:top left;overflow:hidden;background:#0D1B3E}',
  '.scene{position:absolute;inset:0;width:720px;height:1280px;overflow:hidden;background:#0D1B3E;color:white}',
  '.native-bg{position:absolute;inset:0;overflow:hidden;background:radial-gradient(circle at 75% 20%,'+accent+'50 0,transparent 34%),linear-gradient(145deg,#0D1B3E,#17376F 58%,#0A1127)}',
  '.native-number{position:absolute;right:-30px;top:76px;color:rgba(255,255,255,.04);font-size:350px;line-height:1;font-weight:950}',
  '.overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,8,20,.02),rgba(4,8,20,.78))}',
  '.glow{position:absolute;right:-260px;top:120px;width:420px;height:420px;border-radius:999px;background:'+accent+';opacity:.04;filter:blur(80px)}',
  'header{position:absolute;top:60px;left:54px;right:54px;height:28px;display:flex;align-items:center;gap:14px}',
  '.header-mark{width:54px;height:7px;border-radius:999px;background:'+accent+';flex:none}',
  '.brand{font-size:22px;letter-spacing:1.8px;text-transform:uppercase;font-weight:900}',
  '.scene-number{margin-left:auto;font-size:18px;opacity:.68}',
  '.copy{position:absolute;left:58px;right:58px;bottom:280px}',
  '.eyebrow{display:flex;align-items:center;gap:12px;margin-bottom:26px}',
  '.eyebrow-line{width:96px;height:7px;border-radius:99px;background:'+accent+'}',
  '.next{padding:7px 11px;border:1px solid '+accent+'66;border-radius:999px;font-size:13px;font-weight:800;letter-spacing:1.2px}',
  'h1{margin:0;font-size:72px;line-height:1.02;letter-spacing:-2.4px;font-weight:900;max-width:610px;overflow-wrap:break-word;text-shadow:0 8px 30px rgba(0,0,0,.3)}',
  '.scene:first-child h1{text-transform:uppercase}',
  'p{margin:22px 0 0;font-size:24px;line-height:1.35;max-width:570px;opacity:.82;overflow-wrap:break-word}',
  '.caption{position:absolute;left:48px;right:48px;bottom:72px;padding:20px 24px;border-radius:24px;background:rgba(5,10,25,.82);border:1px solid rgba(255,255,255,.14);text-align:center;font-size:27px;line-height:1.25;font-weight:800;overflow-wrap:break-word}',
  '.progress{position:absolute;bottom:0;left:0;width:0;height:7px;background:'+accent+'}'
 ].join("");
 return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"><div id="logical">'+scenes+'</div></div></body></html>';
}
module.exports={generateSyntheticRemotionLook};
