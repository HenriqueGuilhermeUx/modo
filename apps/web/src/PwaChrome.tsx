import { useEffect } from "react";
import { getSessionToken } from "./api";

export default function PwaChrome() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const eligible = path.startsWith("/app") && !path.startsWith("/app/agency") && Boolean(getSessionToken());
  useEffect(() => {
    document.body.classList.toggle("modo-pwa-app-route", eligible);
    return () => document.body.classList.remove("modo-pwa-app-route");
  }, [eligible]);
  if (!eligible) return null;

  const items = [
    ["/app/mobile", "⌂", "Início", path === "/app/mobile"],
    ["/app/content", "+", "Criar", path.startsWith("/app/content") || path.startsWith("/app/criar")],
    ["/app/video", "▶", "Vídeo", path.startsWith("/app/video")],
    ["/app/week", "✓", "Agenda", path.startsWith("/app/week")],
    ["/app/mobile/account", "●", "Conta", path.startsWith("/app/mobile/account")],
  ] as const;

  return <nav className="modo-pwa-tabbar" aria-label="Navegação MODO">
    {items.map(([href, icon, label, active]) => <a className={active ? "active" : ""} href={href} key={href}><b>{icon}</b><span>{label}</span></a>)}
  </nav>;
}
