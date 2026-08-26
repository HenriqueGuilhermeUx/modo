import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  registerRoot,
  useCurrentFrame,
} from "remotion";

type RenderScene = {
  index: number;
  startFrame: number;
  endFrame: number;
  headline: string;
  visual: string;
  caption: string;
  imageUrl: string | null;
  visualType?: "brand_asset" | "generated_image" | "interface" | "data_card" | "kinetic_text";
  motion?: "push_in" | "zoom_out" | "pan_left" | "pan_right" | "static";
  audioUrl?: string | null;
};

type RenderProps = {
  brandName: string;
  title: string;
  accentColor: string;
  captions: boolean;
  scenes: RenderScene[];
};

const defaultProps: RenderProps = {
  brandName: "MODO",
  title: "Conteúdo MODO",
  accentColor: "#2ED19A",
  captions: true,
  scenes: [
    {
      index: 1,
      startFrame: 0,
      endFrame: 450,
      headline: "Conteúdo com direção.",
      visual: "Composição editorial MODO",
      caption: "A MODO transforma estratégia em presença.",
      imageUrl: null,
      visualType: "kinetic_text",
      motion: "push_in",
      audioUrl: null,
    },
  ],
};

function imageTransform(scene: RenderScene, localFrame: number, duration: number) {
  const progress = interpolate(localFrame, [0, duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const motion = scene.motion || "push_in";
  const scale = motion === "zoom_out" ? 1.12 - progress * 0.08 : motion === "static" ? 1.06 : 1.04 + progress * 0.08;
  const x = motion === "pan_left" ? 22 - progress * 44 : motion === "pan_right" ? -22 + progress * 44 : 0;
  return `translateX(${x}px) scale(${scale})`;
}

function InterfaceVisual({ accentColor, localFrame, duration }: { accentColor: string; localFrame: number; duration: number }) {
  const rise = interpolate(localFrame, [0, Math.min(30, duration)], [80, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = interpolate(localFrame % 60, [0, 30, 60], [.68, 1, .68]);
  return React.createElement(
    AbsoluteFill,
    { style: { background: "linear-gradient(145deg,#08142f,#102c5f 58%,#071226)", overflow: "hidden" } },
    React.createElement("div", {
      style: {
        position: "absolute", left: 82, right: 82, top: 180, height: 620,
        borderRadius: 34, border: "1px solid rgba(255,255,255,.18)", background: "rgba(9,20,48,.82)",
        boxShadow: "0 40px 100px rgba(0,0,0,.38)", transform: `translateY(${rise}px) rotate(-1.2deg)`, overflow: "hidden",
      },
    },
      React.createElement("div", { style: { height: 68, borderBottom: "1px solid rgba(255,255,255,.1)", display: "flex", alignItems: "center", gap: 12, padding: "0 24px" } },
        React.createElement("i", { style: { width: 12, height: 12, borderRadius: 99, background: accentColor } }),
        React.createElement("i", { style: { width: 12, height: 12, borderRadius: 99, background: "rgba(255,255,255,.28)" } }),
        React.createElement("i", { style: { width: 12, height: 12, borderRadius: 99, background: "rgba(255,255,255,.14)" } }),
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: 28 } },
        ...[0,1,2,3].map((item) => React.createElement("div", {
          key: item,
          style: { height: item < 2 ? 138 : 178, borderRadius: 22, background: item === 0 ? `${accentColor}24` : "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.08)", padding: 20 },
        },
          React.createElement("div", { style: { width: item === 0 ? "68%" : "44%", height: 10, borderRadius: 99, background: item === 0 ? accentColor : "rgba(255,255,255,.25)", opacity: item === 0 ? pulse : 1 } }),
          React.createElement("div", { style: { marginTop: 18, width: "84%", height: 8, borderRadius: 99, background: "rgba(255,255,255,.12)" } }),
          React.createElement("div", { style: { marginTop: 10, width: "58%", height: 8, borderRadius: 99, background: "rgba(255,255,255,.09)" } }),
        )),
      ),
    ),
  );
}

function DataCardVisual({ accentColor, localFrame, duration }: { accentColor: string; localFrame: number; duration: number }) {
  const progress = interpolate(localFrame, [0, Math.min(48, duration)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const heights = [44, 70, 56, 88, 76];
  return React.createElement(
    AbsoluteFill,
    { style: { background: `radial-gradient(circle at 25% 18%,${accentColor}35,transparent 38%),linear-gradient(150deg,#07142e,#122c59 58%,#081228)` } },
    React.createElement("div", {
      style: { position: "absolute", left: 86, right: 86, top: 210, height: 510, borderRadius: 38, background: "rgba(5,14,36,.7)", border: "1px solid rgba(255,255,255,.14)", padding: 42, boxShadow: "0 35px 100px rgba(0,0,0,.34)" },
    },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
        React.createElement("div", null,
          React.createElement("div", { style: { width: 126, height: 10, borderRadius: 99, background: "rgba(255,255,255,.22)" } }),
          React.createElement("div", { style: { marginTop: 18, width: 220, height: 34, borderRadius: 12, background: accentColor, transform: `scaleX(${.5 + progress * .5})`, transformOrigin: "left" } }),
        ),
        React.createElement("div", { style: { width: 74, height: 74, borderRadius: 22, background: `${accentColor}22`, border: `1px solid ${accentColor}55` } }),
      ),
      React.createElement("div", { style: { position: "absolute", left: 42, right: 42, bottom: 44, height: 240, display: "flex", alignItems: "flex-end", gap: 22 } },
        ...heights.map((height, index) => React.createElement("div", {
          key: index,
          style: { flex: 1, height: `${Math.max(6, height * progress)}%`, borderRadius: "18px 18px 8px 8px", background: index === 3 ? accentColor : "rgba(255,255,255,.16)", boxShadow: index === 3 ? `0 0 36px ${accentColor}33` : "none" },
        })),
      ),
    ),
  );
}

function KineticVisual({ scene, accentColor, localFrame, duration }: { scene: RenderScene; accentColor: string; localFrame: number; duration: number }) {
  const drift = interpolate(localFrame, [0, duration], [-30, 30], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(localFrame, [0, duration], [.94, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return React.createElement(
    AbsoluteFill,
    { style: { background: `radial-gradient(circle at 75% 20%,${accentColor}55 0,transparent 34%),linear-gradient(145deg,#0D1B3E,#17376F 58%,#0A1127)`, overflow: "hidden" } },
    React.createElement("div", { style: { position: "absolute", right: -34, top: 90 + drift, fontSize: 310, lineHeight: 1, fontWeight: 950, color: "rgba(255,255,255,.035)", transform: `scale(${scale})` } }, String(scene.index).padStart(2, "0")),
    React.createElement("div", { style: { position: "absolute", width: 390, height: 390, borderRadius: 999, left: -190 + drift, top: 370, border: `2px solid ${accentColor}22` } }),
    React.createElement("div", { style: { position: "absolute", width: 250, height: 250, borderRadius: 999, left: -110 + drift, top: 440, border: `1px solid ${accentColor}33` } }),
  );
}

function BackgroundVisual({ scene, accentColor, localFrame, duration }: {
  scene: RenderScene;
  accentColor: string;
  localFrame: number;
  duration: number;
}) {
  if (scene.imageUrl) {
    return React.createElement(Img, {
      src: scene.imageUrl,
      style: { width: "100%", height: "100%", objectFit: "cover", transform: imageTransform(scene, localFrame, duration) },
    });
  }
  if (scene.visualType === "interface") {
    return React.createElement(InterfaceVisual, { accentColor, localFrame, duration });
  }
  if (scene.visualType === "data_card") {
    return React.createElement(DataCardVisual, { accentColor, localFrame, duration });
  }
  return React.createElement(KineticVisual, { scene, accentColor, localFrame, duration });
}

function SceneCard({ scene, brandName, accentColor, captions }: {
  scene: RenderScene;
  brandName: string;
  accentColor: string;
  captions: boolean;
}) {
  // Dentro de <Sequence>, useCurrentFrame() já é relativo ao início da cena.
  const localFrame = useCurrentFrame();
  const duration = Math.max(1, scene.endFrame - scene.startFrame);
  const opacity = interpolate(localFrame, [0, 12, Math.max(13, duration - 12), duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(localFrame, [0, 20], [28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: "#0D1B3E", color: "#fff", opacity, overflow: "hidden", fontFamily: "Arial, sans-serif" } },
    React.createElement(BackgroundVisual, { scene, accentColor, localFrame, duration }),
    React.createElement(AbsoluteFill, {
      style: {
        background: scene.imageUrl
          ? "linear-gradient(180deg,rgba(5,10,25,.08) 0%,rgba(5,10,25,.35) 45%,rgba(5,10,25,.94) 100%)"
          : "linear-gradient(180deg,rgba(5,10,25,.04) 0%,rgba(5,10,25,.16) 45%,rgba(5,10,25,.82) 100%)",
      },
    }),
    React.createElement(
      "div",
      { style: { position: "absolute", left: 54, right: 54, top: 60, display: "flex", justifyContent: "space-between", alignItems: "center" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14 } },
        React.createElement("span", { style: { width: 54, height: 7, borderRadius: 999, background: accentColor } }),
        React.createElement("strong", { style: { fontSize: 22, letterSpacing: 1.8, textTransform: "uppercase" } }, brandName.slice(0, 36)),
      ),
      React.createElement("span", { style: { fontSize: 20, opacity: .75 } }, String(scene.index).padStart(2, "0")),
    ),
    React.createElement(
      "div",
      { style: { position: "absolute", left: 58, right: 58, bottom: captions ? 280 : 150, transform: `translateY(${rise}px)` } },
      React.createElement("div", { style: { width: 76, height: 9, borderRadius: 99, background: accentColor, marginBottom: 28 } }),
      React.createElement("h1", { style: { margin: 0, fontSize: 64, lineHeight: 1.02, letterSpacing: -2.4, fontWeight: 900, textShadow: "0 8px 30px rgba(0,0,0,.28)" } }, scene.headline),
      React.createElement("p", { style: { margin: "24px 0 0", fontSize: 24, lineHeight: 1.35, maxWidth: 590, opacity: .82 } }, scene.visual),
    ),
    captions
      ? React.createElement(
          "div",
          { style: { position: "absolute", left: 48, right: 48, bottom: 72, padding: "20px 24px", borderRadius: 24, background: "rgba(5,10,25,.78)", border: "1px solid rgba(255,255,255,.14)", textAlign: "center", fontSize: 27, lineHeight: 1.25, fontWeight: 800 } },
          scene.caption,
        )
      : null,
    React.createElement("div", { style: { position: "absolute", left: 0, bottom: 0, width: `${Math.min(100, Math.max(0, (localFrame / duration) * 100))}%`, height: 7, background: accentColor } }),
  );
}

function ModoVideo(props: RenderProps) {
  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: "#0D1B3E" } },
    ...props.scenes.map((scene) =>
      React.createElement(
        Sequence,
        { key: scene.index, from: scene.startFrame, durationInFrames: Math.max(1, scene.endFrame - scene.startFrame), premountFor: 15 },
        React.createElement(
          React.Fragment,
          null,
          scene.audioUrl ? React.createElement(Audio, { src: scene.audioUrl, volume: 1 }) : null,
          React.createElement(SceneCard, {
            scene,
            brandName: props.brandName,
            accentColor: props.accentColor,
            captions: props.captions,
          }),
        ),
      ),
    ),
  );
}

function Root() {
  const VideoComposition = Composition as React.ComponentType<Record<string, unknown>>;
  const composition = (id: string, durationInFrames: number) => React.createElement(VideoComposition, {
    id,
    component: ModoVideo,
    width: 720,
    height: 1280,
    fps: 30,
    durationInFrames,
    defaultProps,
  });
  return React.createElement(React.Fragment, null,
    composition("ModoVideo15", 450),
    composition("ModoVideo30", 900),
    composition("ModoVideo45", 1350),
  );
}

registerRoot(Root);
