"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {syntheticTemporalFilter}=require("./static-temporal-zoompan-synthetic.cjs");
const three=()=>[
 {startFrame:0,endFrame:31},
 {startFrame:31,endFrame:95},
 {startFrame:95,endFrame:150}
];
test("Only signed three-scene 150-frame timeline emits bounded per-frame zoompan",()=>{
 const filter=syntheticTemporalFilter(three());
 assert.equal(filter,(syntheticTemporalFilter(three())));
 assert.match(filter,/zoompan=z='min\(zoom\+0\.0006,1\.028\)'/);
 assert.equal((filter.match(/zoompan=/g)||[]).length,3);
 assert.ok(filter.includes("trim=end_frame=31")&&
   filter.includes("trim=end_frame=64")&&
   filter.includes("trim=end_frame=55"));
 assert.ok(filter.includes("concat=n=3:v=1:a=0,format=yuv420p[v]"));
 assert.doesNotMatch(filter,/https?:\/\/|file:|movie=|amovie=|\beval\b/);
});
test("Rejects malformed spans, gaps, scene count, negative and overlong work",()=>{
 const alterations=[
  s=>s.pop(),s=>s.push({startFrame:150,endFrame:181}),
  s=>s[0].startFrame=-1,s=>s[1].startFrame=30,
  s=>s[2].endFrame=600,s=>s[1].endFrame=95.2,
  s=>s[1].startFrame="31",s=>s[0].endFrame=10
 ];
 for(const change of alterations){
  const list=three();change(list);
  assert.throws(()=>syntheticTemporalFilter(list),
   /HF_SYNTHETIC_TEMPORAL_(?:UNSUPPORTED|INVALID_TIMING|FRAME_LIMIT)/);
 }
});
test("FFmpeg filter is independent of optional tenant copy and is fixed by signed frame counts",()=>{
 const a=three(),b=three();
 b[0].headline="<script>alert('no')</script>";b[1].caption="evil;movie=/etc/passwd";
 assert.equal(syntheticTemporalFilter(a),syntheticTemporalFilter(b));
});
