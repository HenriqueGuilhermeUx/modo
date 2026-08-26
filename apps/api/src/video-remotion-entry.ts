import React from "react";
import {
  AbsoluteFill,
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
    },
  ],
};

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
  const scale = interpolate(localFrame, [0, duration], [1.04, 1.11], {
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
    scene.imageUrl
      ? React.createElement(Img, {
          src: scene.imageUrl,
          style: { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` },
        })
      : React.createElement(AbsoluteFill, {
          style: {
            background: `radial-gradient(circle at 78% 18%, ${accentColor}55 0, transparent 34%), linear-gradient(145deg,#0D1B3E,#17376F 58%,#0A1127)`,
          },
        }),
    React.createElement(AbsoluteFill, {
      style: {
        background: "linear-gradient(180deg,rgba(5,10,25,.08) 0%,rgba(5,10,25,.35) 45%,rgba(5,10,25,.94) 100%)",
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
        React.createElement(SceneCard, {
          scene,
          brandName: props.brandName,
          accentColor: props.accentColor,
          captions: props.captions,
        }),
      ),
    ),
  );
}

function Root() {
  const composition = (id: string, durationInFrames: number) => React.createElement(Composition<RenderProps>, {
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
