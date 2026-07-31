import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ProductPathGuide from "./ProductPathGuide";

type GuideMode = "public" | "portal";

interface Props {
  mode: GuideMode;
}

export default function ProductPathGuideAddon({ mode }: Props) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const rootId = `modo-product-path-${mode}-root`;
    document.getElementById(rootId)?.remove();

    const root = document.createElement("div");
    root.id = rootId;

    if (mode === "public") {
      const diagnostic = document.querySelector<HTMLElement>(".diagnostic-section");
      diagnostic?.parentElement?.insertBefore(root, diagnostic);

      const navigation = document.querySelector<HTMLElement>(".fishing-header .nav");
      const firstLink = navigation?.querySelector<HTMLAnchorElement>("a");
      const guideLink = document.createElement("a");
      guideLink.href = "#caminhos-modo";
      guideLink.textContent = "Por onde começar";
      if (navigation && !navigation.querySelector('a[href="#caminhos-modo"]')) {
        navigation.insertBefore(guideLink, firstLink || null);
      }

      setTarget(root.isConnected ? root : null);
      return () => {
        root.remove();
        guideLink.remove();
      };
    }

    const overview = document.querySelector<HTMLElement>(".portal-overview");
    overview?.parentElement?.insertBefore(root, overview);
    setTarget(root.isConnected ? root : null);

    return () => root.remove();
  }, [mode]);

  return target ? createPortal(<ProductPathGuide mode={mode} />, target) : null;
}
