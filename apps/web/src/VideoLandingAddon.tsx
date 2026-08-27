import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./video-landing.css";

function replaceLegacyVideoCopy() {
  document.querySelectorAll<HTMLElement>(".fishing-output-card > div").forEach((item) => {
    const strong = item.querySelector("strong");
    const small = item.querySelector("small");
    if (strong?.textContent?.includes("Vídeo de 45 segundos") && small) small.textContent = "Primeiro corte pronto";
  });

  document.querySelectorAll<HTMLElement>(".fishing-value-grid article").forEach((item) => {
    const title = item.querySelector("h3");
    const copy = item.querySelector("p");
    if (title?.textContent === "Dirige vídeos e histórias" && copy) {
      title.textContent = "Produz vídeos curtos";
      copy.textContent = "Transforma a estratégia em Reel com cenas, imagens ou B-roll, narração opcional, trilha, legendas, ritmo e transições.";
    }
  });

  document.querySelectorAll<HTMLElement>(".fishing-channels aside li").forEach((item) => {
    if (item.textContent?.includes("roteiro de vídeo com rosto")) item.textContent = "1 primeiro corte de Reel pronto para revisar";
  });

  document.querySelectorAll<HTMLElement>(".fishing-faq details").forEach((item) => {
    const summary = item.querySelector("summary");
    const copy = item.querySelector("p");
    if (summary?.textContent === "Preciso aparecer em vídeo?" && copy) {
      copy.textContent = "Não. A MODO pode produzir vídeos sem rosto com imagens, B-roll, texto, trilha, legendas e narração por IA. Se você quiser, também pode trocar qualquer cena pela sua própria foto ou vídeo.";
    }
  });
}

export default function VideoLandingAddon() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    replaceLegacyVideoCopy();
    let root = document.getElementById("modo-video-landing-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "modo-video-landing-root";
      const channels = document.querySelector(".fishing-channels");
      channels?.parentElement?.insertBefore(root, channels);
    }
    setTarget(root);
  }, []);

  if (!target) return null;
  return createPortal(
    <section className="modo-video-landing" id="video">
      <div className="container">
        <div className="modo-video-landing-head">
          <div className="section-kicker">MODO VIDEO · DO OBJETIVO AO REEL</div>
          <h2>Você não começa numa timeline vazia. <strong>O primeiro corte já chega montado.</strong></h2>
          <p>A MODO usa a estratégia e o roteiro da sua marca para montar um vídeo vertical completo. Depois, você só mexe nas exceções — se quiser.</p>
        </div>

        <div className="modo-video-landing-columns">
          <article>
            <small>A MODO FAZ</small>
            <h3>Produção com direção de marketing.</h3>
            <ul>
              <li><span>01</span><div><strong>Planeja as cenas</strong><p>Gancho, desenvolvimento e CTA saem do conteúdo que a MODO já decidiu.</p></div></li>
              <li><span>02</span><div><strong>Monta o visual</strong><p>Combina imagem da marca, imagem editorial, B-roll, interface, data card e kinetic text.</p></div></li>
              <li><span>03</span><div><strong>Fecha o audiovisual</strong><p>Adiciona trilha, legendas, ritmo, transições e, quando ativada, narração PT-BR por IA.</p></div></li>
              <li><span>04</span><div><strong>Entrega o MP4</strong><p>Reel 9:16 em H.264 pronto para revisão, aprovação e distribuição.</p></div></li>
            </ul>
          </article>

          <article className="human-control">
            <small>VOCÊ DECIDE</small>
            <h3>Controle sem virar editor de vídeo.</h3>
            <ul>
              <li><span>✓</span><div><strong>Troque só uma cena</strong><p>Regere o visual ou busque outro B-roll sem reconstruir o vídeo.</p></div></li>
              <li><span>✓</span><div><strong>Use sua própria mídia</strong><p>Envie foto ou MP4, ajuste enquadramento, zoom e o início do take.</p></div></li>
              <li><span>✓</span><div><strong>Escolha a linguagem</strong><p>Deixe a MODO decidir ou use direção Editorial, Premium, Humana ou Dinâmica.</p></div></li>
              <li><span>✓</span><div><strong>Aprove cena por cena</strong><p>A decisão humana continua antes da publicação.</p></div></li>
            </ul>
          </article>
        </div>

        <div className="modo-video-landing-promise">
          <div><small>EM UMA FRASE</small><strong>Sua estratégia já sai em vídeo.</strong></div>
          <a className="button button-primary" href="/app">Criar meu primeiro Reel ↗</a>
        </div>
      </div>
    </section>,
    target,
  );
}
