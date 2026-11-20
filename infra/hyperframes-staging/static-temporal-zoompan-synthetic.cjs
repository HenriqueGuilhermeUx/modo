"use strict";
/**
 * Synthetic-only bounded per-frame FFmpeg camera motion on an Ed25519-vetted
 * three-scene static storyboard. No external paths, expressions, URLs,
 * arbitrary user filters or unbounded frame counts reach FFmpeg.
 *
 * This introduces REAL frame-dependent pixel motion, but does NOT claim
 * Remotion-equivalent text movement, transitions, audio or publication.
 */
function syntheticTemporalFilter(scenes) {
 if(!Array.isArray(scenes)||scenes.length!==3)throw Error("HF_SYNTHETIC_TEMPORAL_UNSUPPORTED");
 let next=0,total=0;
 const parts=[];
 for(let i=0;i<scenes.length;i++){
  const s=scenes[i],frames=s?.endFrame-s?.startFrame;
  if(!Number.isSafeInteger(s?.startFrame)||!Number.isSafeInteger(s?.endFrame)||
     s.startFrame!==next||!Number.isSafeInteger(frames)||
     frames<30||frames>120)throw Error("HF_SYNTHETIC_TEMPORAL_INVALID_TIMING");
  next=s.endFrame;total+=frames;
  parts.push("["+i+":v]zoompan=z='min(zoom+0.0006,1.028)'"+
   ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"+
   ":d=1:s=1080x1920:fps=30,trim=end_frame="+frames+
   ",setpts=PTS-STARTPTS,format=yuv420p[s"+i+"]");
 }
 if(total>360)throw Error("HF_SYNTHETIC_TEMPORAL_FRAME_LIMIT");
 parts.push(scenes.map((_,i)=>"[s"+i+"]").join("")+
  "concat=n="+scenes.length+":v=1:a=0,format=yuv420p[v]");
 return parts.join(";");
}
module.exports={syntheticTemporalFilter};
