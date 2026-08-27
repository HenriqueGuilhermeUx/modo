import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  useCurrentFrame,
} from "remotion";
import {
  chooseVideoSoundtrackProfile,
  createVideoSoundtrackDataUri,
  soundtrackVolumeAtFrame,
} from "./video-audio-engine.js";

type ScenePace = "calm" | "steady" | "dynamic";
type SceneTransition = "cut" | "fade" | "slide" | "zoom" | "wipe";
type CreativeProfile = "editorial" | "premium" | "human" | "dynamic";

type RenderScene = {
  index: number;
  startFrame: number;
  endFrame: number;
  headline: string;
  visual: string;
  caption: string;
  imageUrl: string | null;
  videoUrl?: string | null;
  visualType?: "brand_asset" | "generated_image" | "broll_video" | "interface" | "data_card" | "kinetic_text";
  motion?: "push_in" | "zoom_out" | "pan_left" | "pan_right" | "static";
  pace?: ScenePace;
  transition?: SceneTransition;
  assetRevision?: number;
  audioUrl?: string | null;
};

type RenderProps = {
  brandName: string;
  title: string;
  accentColor: string;
  captions: boolean;
  scenes: RenderScene[];
};

type MediaState = { focalX: number; focalY: number; zoom: number; trimStartSeconds: number };

const defaultProps: RenderProps = {
  brandName: "MODO",
  title: "Conteúdo MODO",
  accentColor: "#2ED19A",
  captions: true,
  scenes: [{
    index: 1,
    startFrame: 0,
    endFrame: 450,
    headline: "Conteúdo com direção.",
    visual: "Composição editorial MODO",
    caption: "A MODO transforma estratégia em presença.",
    imageUrl: null,
    videoUrl: null,
    visualType: "kinetic_text",
    motion: "push_in",
    pace: "dynamic",
    transition: "cut",
    assetRevision: 0,
    audioUrl: null,
  }],
};

function explicitProfile(scene?: RenderScene): CreativeProfile | null {
  if (!scene) return null;
  if (scene.motion === "static" && scene.pace === "steady" && scene.transition === "wipe") return "editorial";
  if (scene.motion === "zoom_out" && scene.pace === "calm" && scene.transition === "zoom") return "premium";
  if (scene.motion === "pan_right" && scene.pace === "calm" && scene.transition === "slide") return "human";
  if (scene.motion === "push_in" && scene.pace === "dynamic" && scene.transition === "fade") return "dynamic";
  return null;
}

function creativeProfile(scenes: RenderScene[]): CreativeProfile {
  const explicit = explicitProfile(scenes[0]);
  if (explicit) return explicit;
  const corpus = scenes.map((scene) => `${scene.headline} ${scene.visual} ${scene.caption}`).join(" ").toLocaleLowerCase("pt-BR");
  const broll = scenes.filter((scene) => scene.visualType === "broll_video").length;
  const kinetic = scenes.filter((scene) => scene.visualType === "kinetic_text").length;
  if (/(premium|sofisticad|exclusiv|luxo|alto padr[aã]o|arquitet|est[eé]tica|elegan)/i.test(corpus)) return "premium";
  if (broll >= Math.max(2, Math.ceil(scenes.length / 3)) || /(pessoa|cliente|equipe|fam[ií]lia|bastidor|atendimento|profissional)/i.test(corpus)) return "human";
  if (kinetic >= Math.max(2, Math.ceil(scenes.length / 2)) || /(lan[cç]amento|oferta|promo[cç][aã]o|agora|r[aá]pid|novidade|urgente|desafio)/i.test(corpus)) return "dynamic";
  return "editorial";
}

function paceForScene(scene: RenderScene): ScenePace {
  if (scene.pace) return scene.pace;
  if (scene.visualType === "broll_video" || scene.visualType === "kinetic_text") return "dynamic";
  if (scene.visualType === "interface" || scene.visualType === "data_card") return "calm";
  return "steady";
}

function transitionForScene(scene: RenderScene): SceneTransition {
  if (scene.transition) return scene.transition;
  if (scene.index === 1) return "cut";
  const options: SceneTransition[] = ["fade", "slide", "zoom", "wipe"];
  return options[(scene.index + Math.max(0, scene.assetRevision || 0) - 2) % options.length];
}

function paceMultiplier(scene: RenderScene) {
  const pace = paceForScene(scene);
  if (pace === "dynamic") return 1.35;
  if (pace === "calm") return 0.65;
  return 1;
}

function numericParam(url: URL, key: string, fallback: number) {
  const value = Number(url.searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function mediaState(scene: RenderScene): MediaState {
  const source = scene.videoUrl || scene.imageUrl;
  if (!source) return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0 };
  try {
    const url = new URL(source);
    return {
      focalX: Math.min(100, Math.max(0, numericParam(url, "mlfx", 50))),
      focalY: Math.min(100, Math.max(0, numericParam(url, "mlfy", 50))),
      zoom: Math.min(2.5, Math.max(1, numericParam(url, "mlz", 1))),
      trimStartSeconds: Math.min(120, Math.max(0, numericParam(url, "mltrim", 0))),
    };
  } catch {
    return { focalX: 50, focalY: 50, zoom: 1, trimStartSeconds: 0 };
  }
}

function mediaTransform(scene: RenderScene, frame: number, duration: number, profile: CreativeProfile) {
  const progress = interpolate(frame, [0, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pace = paceMultiplier(scene) * (profile === "dynamic" ? 1.12 : profile === "premium" ? .82 : 1);
  const motion = scene.motion || "push_in";
  const state = mediaState(scene);
  const travel = .075 * pace;
  const base = profile === "premium" ? 1.02 : profile === "human" ? 1.025 : 1.035;
  const motionScale = motion === "zoom_out" ? 1.12 - progress * travel : motion === "static" ? base + .015 : base + progress * travel;
  const pan = 42 * pace;
  const x = motion === "pan_left" ? pan / 2 - progress * pan : motion === "pan_right" ? -pan / 2 + progress * pan : 0;
  return `translateX(${x}px) scale(${motionScale * state.zoom})`;
}

function mediaFilter(scene: RenderScene, profile: CreativeProfile) {
  if (profile === "premium") return "saturate(.92) contrast(1.08) brightness(.86)";
  if (profile === "human") return "saturate(1.06) contrast(1.02) brightness(.96)";
  if (profile === "dynamic") return "saturate(1.15) contrast(1.09) brightness(.91)";
  if (scene.visualType === "broll_video") return "saturate(1.08) contrast(1.06) brightness(.92)";
  return "saturate(1.04) contrast(1.04) brightness(.94)";
}

function mediaStyle(scene: RenderScene, frame: number, duration: number, profile: CreativeProfile): React.CSSProperties {
  const state = mediaState(scene);
  return {
    width: "100%", height: "100%", objectFit: "cover",
    objectPosition: `${state.focalX}% ${state.focalY}%`,
    transformOrigin: `${state.focalX}% ${state.focalY}%`,
    transform: mediaTransform(scene, frame, duration, profile),
    filter: mediaFilter(scene, profile),
  };
}

function transitionStyle(scene: RenderScene, frame: number, duration: number, isLast: boolean): React.CSSProperties {
  const transition = transitionForScene(scene);
  const pace = paceForScene(scene);
  const entryFrames = transition === "cut" ? 1 : pace === "dynamic" ? 8 : pace === "calm" ? 16 : 12;
  const entry = interpolate(frame, [0, entryFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outro = isLast ? interpolate(frame, [Math.max(0, duration - 12), duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  if (transition === "cut") return { opacity: outro };
  if (transition === "fade") return { opacity: entry * outro };
  if (transition === "slide") return { opacity: outro, transform: `translateX(${(1 - entry) * 72}px)` };
  if (transition === "zoom") return { opacity: entry * outro, transform: `scale(${.94 + entry * .06})` };
  return { opacity: outro, clipPath: `inset(${(1 - entry) * 100}% 0 0 0)` };
}

function NativeVisual({ scene, accentColor, frame, duration, profile }: { scene: RenderScene; accentColor: string; frame: number; duration: number; profile: CreativeProfile }) {
  const progress = interpolate(frame, [0, Math.min(42, duration)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (scene.visualType === "interface") {
    return React.createElement(AbsoluteFill, { style: { background: "linear-gradient(145deg,#07142d,#153568 58%,#081327)" } },
      React.createElement("div", { style: { position: "absolute", left: 76, right: 76, top: 180, height: 620, borderRadius: profile === "premium" ? 18 : 34, border: "1px solid rgba(255,255,255,.18)", background: "rgba(8,19,45,.84)", padding: 28, transform: `translateY(${(1 - progress) * 70}px)` } },
        ...[0,1,2,3].map((item) => React.createElement("div", { key: item, style: { height: item === 0 ? 105 : 72, marginBottom: 18, borderRadius: 18, background: item === 0 ? `${accentColor}22` : "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.08)" } })),
      ),
    );
  }
  if (scene.visualType === "data_card") {
    return React.createElement(AbsoluteFill, { style: { background: `radial-gradient(circle at 28% 20%,${accentColor}35,transparent 38%),linear-gradient(150deg,#07142e,#122c59 58%,#081228)` } },
      React.createElement("div", { style: { position: "absolute", left: 82, right: 82, top: 220, height: 480, borderRadius: 34, background: "rgba(5,14,36,.72)", padding: 42, border: "1px solid rgba(255,255,255,.14)" } },
        React.createElement("div", { style: { width: `${48 + progress * 40}%`, height: 28, borderRadius: 10, background: accentColor } }),
        React.createElement("div", { style: { position: "absolute", left: 42, right: 42, bottom: 44, height: 230, display: "flex", alignItems: "flex-end", gap: 18 } }, ...[48,72,58,90,78].map((height,index) => React.createElement("i", { key:index, style:{ flex:1, height:`${height * progress}%`, borderRadius:"14px 14px 6px 6px", background:index===3?accentColor:"rgba(255,255,255,.16)" } }))),
      ),
    );
  }
  const drift = interpolate(frame, [0, duration], [-24, 30], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return React.createElement(AbsoluteFill, { style: { background: profile === "premium" ? `radial-gradient(circle at 75% 18%,${accentColor}24,transparent 30%),linear-gradient(150deg,#09152d,#111b33 65%,#070c18)` : `radial-gradient(circle at 75% 20%,${accentColor}50 0,transparent 34%),linear-gradient(145deg,#0D1B3E,#17376F 58%,#0A1127)`, overflow:"hidden" } },
    React.createElement("div", { style: { position:"absolute", right:-30, top:90+drift, fontSize: profile === "dynamic" ? 350 : 300, lineHeight:1, fontWeight:950, color:"rgba(255,255,255,.04)" } }, String(scene.index).padStart(2,"0")),
  );
}

function BackgroundVisual({ scene, accentColor, frame, duration, profile }: { scene: RenderScene; accentColor: string; frame: number; duration: number; profile: CreativeProfile }) {
  if (scene.videoUrl) {
    const state = mediaState(scene);
    return React.createElement(OffthreadVideo, { src: scene.videoUrl, muted: true, trimBefore: Math.round(state.trimStartSeconds * 30), style: mediaStyle(scene, frame, duration, profile) });
  }
  if (scene.imageUrl) return React.createElement(Img, { src: scene.imageUrl, style: mediaStyle(scene, frame, duration, profile) });
  return React.createElement(NativeVisual, { scene, accentColor, frame, duration, profile });
}

function Overlay({ scene, accentColor, frame, profile }: { scene: RenderScene; accentColor: string; frame: number; profile: CreativeProfile }) {
  const beat = interpolate(frame % 45, [0, 9, 45], [.1, .24, .1]);
  const bottomAlpha = profile === "premium" ? .96 : profile === "human" ? .86 : .92;
  return React.createElement(React.Fragment, null,
    React.createElement(AbsoluteFill, { style: { background: scene.imageUrl || scene.videoUrl ? `linear-gradient(180deg,rgba(4,8,20,.04) 0%,rgba(4,8,20,.18) 42%,rgba(4,8,20,${bottomAlpha}) 100%)` : "linear-gradient(180deg,rgba(4,8,20,.02),rgba(4,8,20,.78))" } }),
    React.createElement("div", { style: { position:"absolute", width:420, height:420, borderRadius:999, right:-260, top:120, background:accentColor, opacity:beat*(profile === "dynamic" ? .28 : .14), filter:"blur(80px)" } }),
  );
}

function SceneCard({ scene, brandName, accentColor, captions, isLast, profile }: { scene: RenderScene; brandName: string; accentColor: string; captions: boolean; isLast: boolean; profile: CreativeProfile }) {
  const frame = useCurrentFrame();
  const duration = Math.max(1, scene.endFrame - scene.startFrame);
  const pace = paceForScene(scene);
  const rise = interpolate(frame, [0, pace === "dynamic" ? 14 : pace === "calm" ? 28 : 20], [pace === "dynamic" ? 42 : 28, 0], { extrapolateLeft:"clamp", extrapolateRight:"clamp" });
  const alternate = scene.index % 2 === 0;
  const headlineSize = profile === "dynamic" ? 72 : profile === "premium" ? 58 : profile === "human" ? 61 : 64;
  const headlineWeight = profile === "premium" ? 800 : 900;
  const copyLeft = profile === "editorial" && alternate ? 90 : 58;
  const copyRight = profile === "editorial" && alternate ? 42 : 58;
  const copyBottom = captions ? (profile === "premium" ? 300 : 280) : (profile === "premium" ? 175 : 150);

  return React.createElement(AbsoluteFill, { style: { backgroundColor:"#0D1B3E", color:"#fff", overflow:"hidden", fontFamily:"Arial, sans-serif", ...transitionStyle(scene, frame, duration, isLast) } },
    React.createElement(BackgroundVisual, { scene, accentColor, frame, duration, profile }),
    React.createElement(Overlay, { scene, accentColor, frame, profile }),
    React.createElement("div", { style: { position:"absolute", left:54, right:54, top:60, display:"flex", justifyContent:"space-between", alignItems:"center" } },
      React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:14 } }, React.createElement("span", { style:{ width: profile === "premium" ? 34 : 54, height: profile === "premium" ? 4 : 7, borderRadius:999, background:accentColor } }), React.createElement("strong", { style:{ fontSize: profile === "premium" ? 18 : 22, letterSpacing: profile === "premium" ? 2.6 : 1.8, textTransform:"uppercase" } }, brandName.slice(0,36))),
      React.createElement("span", { style:{ fontSize:18, opacity:.68 } }, String(scene.index).padStart(2,"0")),
    ),
    React.createElement("div", { style:{ position:"absolute", left:copyLeft, right:copyRight, bottom:copyBottom, transform:`translateY(${rise}px)` } },
      React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:12, marginBottom: profile === "premium" ? 34 : 26 } },
        React.createElement("span", { style:{ width: profile === "dynamic" ? 96 : 72, height:7, borderRadius:99, background:accentColor } }),
        isLast ? React.createElement("span", { style:{ padding:"7px 11px", border:`1px solid ${accentColor}66`, borderRadius:999, fontSize:13, fontWeight:800, letterSpacing:1.2 } }, "PRÓXIMO PASSO") : null,
      ),
      React.createElement("h1", { style:{ margin:0, fontSize:headlineSize, lineHeight: profile === "premium" ? 1.08 : 1.02, letterSpacing: profile === "premium" ? -1.4 : -2.4, fontWeight:headlineWeight, textTransform: profile === "dynamic" && scene.index === 1 ? "uppercase" : "none", maxWidth: profile === "premium" ? 560 : 610, textShadow:"0 8px 30px rgba(0,0,0,.3)" } }, scene.headline),
      React.createElement("p", { style:{ margin:"22px 0 0", fontSize: profile === "premium" ? 21 : 24, lineHeight:1.35, maxWidth:570, opacity: profile === "premium" ? .7 : .82 } }, scene.visual),
    ),
    captions ? React.createElement("div", { style:{ position:"absolute", left:48, right:48, bottom:72, padding: profile === "premium" ? "18px 24px" : "20px 24px", borderRadius: profile === "premium" ? 12 : 24, background: profile === "human" ? "rgba(5,10,25,.72)" : "rgba(5,10,25,.82)", border:"1px solid rgba(255,255,255,.14)", textAlign:"center", fontSize: profile === "premium" ? 24 : 27, lineHeight:1.25, fontWeight: profile === "premium" ? 700 : 800 } }, scene.caption) : null,
    React.createElement("div", { style:{ position:"absolute", left:0, bottom:0, width:`${Math.min(100,Math.max(0,(frame/duration)*100))}%`, height: profile === "premium" ? 4 : 7, background:accentColor } }),
  );
}

function ModoVideo(props: RenderProps) {
  const scenes = props.scenes.length ? props.scenes : defaultProps.scenes;
  const totalFrames = Math.max(...scenes.map((scene) => scene.endFrame), 1);
  const profile = creativeProfile(scenes);
  const soundtrackProfile = chooseVideoSoundtrackProfile(scenes);
  const soundtrackUrl = createVideoSoundtrackDataUri(soundtrackProfile);
  const baseVolume = scenes.some((scene) => Boolean(scene.audioUrl)) ? .13 : .16;
  return React.createElement(AbsoluteFill, { style:{ backgroundColor:"#0D1B3E" } },
    React.createElement(Audio, { src:soundtrackUrl, loop:true, volume:(frame:number)=>soundtrackVolumeAtFrame({ frame,totalFrames,scenes,baseVolume }) }),
    ...scenes.map((scene,index)=>React.createElement(Sequence, { key:scene.index, from:scene.startFrame, durationInFrames:Math.max(1,scene.endFrame-scene.startFrame), premountFor:15 },
      React.createElement(React.Fragment, null,
        scene.audioUrl ? React.createElement(Audio, { src:scene.audioUrl, volume:1 }) : null,
        React.createElement(SceneCard, { scene, brandName:props.brandName, accentColor:props.accentColor, captions:props.captions, isLast:index===scenes.length-1, profile }),
      ),
    )),
  );
}

function Root() {
  const VideoComposition = Composition as React.ComponentType<Record<string, unknown>>;
  const composition = (id:string,durationInFrames:number)=>React.createElement(VideoComposition,{ id,component:ModoVideo,width:720,height:1280,fps:30,durationInFrames,defaultProps });
  return React.createElement(React.Fragment,null,composition("ModoVideo15",450),composition("ModoVideo30",900),composition("ModoVideo45",1350));
}

registerRoot(Root);
