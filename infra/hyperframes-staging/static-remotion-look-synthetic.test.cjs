"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {generateSyntheticRemotionLook}=require("./static-remotion-look-synthetic.cjs");
const fixture=()=>({width:1080,height:1920,fps:30,
 brandName:"Marca & <script>alert(1)</script>",accentColor:"#2ED19A",
 scenes:[[0,31],[31,95],[95,150]].map(([startFrame,endFrame],i)=>({
  startFrame,endFrame,headline:i===0?"<b>NAO EXECUTAR</b>":"Cena "+(i+1),
  caption:"Quadros "+startFrame+" a "+(endFrame-1)
 }))});
test("signed-text-only pilot creates faithful scaled Remotion static visual structure",()=>{
 const html=generateSyntheticRemotionLook(fixture());
 assert.match(html,/transform:scale\(1\.5\)/);
 assert.match(html,/width:720px;height:1280px/);
 assert.match(html,/radial-gradient\(circle at 75% 20%/);
 assert.match(html,/linear-gradient\(145deg,#0D1B3E,#17376F 58%,#0A1127\)/);
 assert.match(html,/font-size:72px/);
 assert.match(html,/class="caption"/);
 assert.match(html,/class="native-number"/);
 assert.match(html,/class="progress"/);
 assert.match(html,/PRÓXIMO PASSO/);
 assert.equal((html.match(/<section class="scene"/g)||[]).length,3);
 assert.match(html,/Marca &amp; &lt;script&gt;/);
 assert.match(html,/&lt;b&gt;NAO EXECUTAR&lt;\/b&gt;/);
 assert.doesNotMatch(html,/<script>|<b>NAO/);
 assert.doesNotMatch(html,/https?:\/\/|<iframe|src=/);
});
test("CSS look is deterministic and has no scripts or user-defined stylesheet",()=>{
 const a=fixture(),one=generateSyntheticRemotionLook(a);
 assert.equal(generateSyntheticRemotionLook(fixture()),one);
 assert.match(one,/background:#0D1B3E/);
 a.accentColor="#ffffff";
 const other=generateSyntheticRemotionLook(a);
 assert.notEqual(other,one);
 assert.doesNotMatch(one,/onload=|onclick=|<script/i);
});
test("narrow signed-only 3-scene feature gate rejects unsupported layouts",()=>{
 for(const adjust of [
  p=>p.scenes.pop(),p=>p.width=720,p=>p.fps=24,
  p=>p.accentColor="url(https://bad.test/)",p=>p.brandName=2,
  p=>p.scenes[1].caption=null,p=>p.scenes[0].headline=null
 ]){
  const p=fixture();adjust(p);
  assert.throws(()=>generateSyntheticRemotionLook(p),
   /HF_STATIC_REMOTION_LOOK_INVALID/);
 }
});
