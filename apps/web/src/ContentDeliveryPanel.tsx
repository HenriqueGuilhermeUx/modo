import type { ContentRequest } from "@modo/contracts/content";
import "./content-delivery.css";

const deliverableLabels: Record<ContentRequest["contentType"], string> = {
  static_post: "Post principal",
  carousel: "Carrossel completo",
  story: "Sequência de Stories",
  short_video_script: "Roteiro de vídeo",
  channel_adaptation: "Adaptação de canal",
};

function AssetActions({ request }: { request: ContentRequest }) {
  const output = request.output;
  if (!output?.imageUrl) return null;
  return (
    <div className="delivery-image-actions">
      <a className="button button-secondary" href={output.imageUrl} target="_blank" rel="noreferrer">
        Ver imagem em tela cheia
      </a>
      <a className="button button-primary" href={`/app/studio/${request.id}`}>
        Editar e baixar no Studio
      </a>
    </div>
  );
}

function VisualSet({ request }: { request: ContentRequest }) {
  const output = request.output;
  if (!output || !["carousel", "story"].includes(request.contentType)) return null;
  const expected = request.contentType === "carousel" ? output.slides.length : output.storyFrames.length;
  const generated = output.visualAssets.filter((asset) => asset.imageStatus === "generated" && asset.imageUrl);

  return (
    <section className="delivery-visual-set">
      <div className="delivery-section-heading">
        <div>
          <small>ARTES DO FORMATO</small>
          <h4>{request.contentType === "carousel" ? "Slides visuais" : "Stories visuais"}</h4>
          <p>{generated.length} de {expected} arte(s) visual(is) concluída(s).</p>
        </div>
        <span className={generated.length === expected && expected > 0 ? "complete" : "partial"}>
          {generated.length === expected && expected > 0 ? "Kit completo" : "Entrega parcial"}
        </span>
      </div>
      <div className="delivery-asset-grid">
        {output.visualAssets.map((asset) => (
          <article key={`${asset.kind}-${asset.index}`} className={`delivery-asset-card ${asset.kind} ${asset.imageStatus}`}>
            {asset.imageUrl ? (
              <a href={asset.imageUrl} target="_blank" rel="noreferrer">
                <img src={asset.imageUrl} alt={asset.imageAlt || asset.label} loading="lazy" crossOrigin="anonymous" />
              </a>
            ) : (
              <div className="delivery-asset-missing">Visual não concluído</div>
            )}
            <div>
              <small>{String(asset.index).padStart(2, "0")}</small>
              <strong>{asset.label}</strong>
              {asset.imageUrl && <a href={asset.imageUrl} target="_blank" rel="noreferrer">Abrir arte ↗</a>}
            </div>
          </article>
        ))}
      </div>
      {output.visualAssets.length === 0 && (
        <div className="delivery-legacy-note">
          Este pedido foi produzido antes da geração de kits visuais. Crie um novo carrossel ou uma nova sequência de Stories a partir da peça aprovada para receber as artes individuais.
        </div>
      )}
    </section>
  );
}

function FormatStructure({ request }: { request: ContentRequest }) {
  const output = request.output;
  if (!output) return null;

  if (request.contentType === "carousel") {
    return (
      <section className="delivery-structure">
        <small>ESTRUTURA DO CARROSSEL</small>
        <div className="content-slide-list">
          {output.slides.map((slide, index) => (
            <article key={`${slide.title}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{slide.title}</strong><p>{slide.body}</p></div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (request.contentType === "story") {
    return (
      <section className="delivery-structure">
        <small>SEQUÊNCIA DE STORIES</small>
        <div className="content-slide-list">
          {output.storyFrames.map((frame, index) => (
            <article key={`${frame.headline}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{frame.headline}</strong>
                <p>{frame.body}</p>
                {frame.interaction && <p><b>Interação:</b> {frame.interaction}</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (request.contentType === "short_video_script") {
    return (
      <section className="delivery-structure">
        <small>ROTEIRO</small>
        <div className="content-slide-list">
          {output.script.map((scene, index) => (
            <article key={`${scene.scene}-${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{scene.scene}</strong>
                <p><b>Visual:</b> {scene.visual}</p>
                <p><b>Locução:</b> {scene.voiceover}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return null;
}

export default function ContentDeliveryPanel({ request }: { request: ContentRequest }) {
  const output = request.output;
  if (!output) return null;

  return (
    <div className="delivery-panel">
      <section className="delivery-summary-card">
        <div className="delivery-section-heading">
          <div>
            <small>ENTREGA SOLICITADA</small>
            <h3>{deliverableLabels[request.contentType]}</h3>
            <p>Abaixo está o material realmente produzido para este pedido.</p>
          </div>
          <span className="complete">Pronto para revisão</span>
        </div>
      </section>

      {output.imageUrl ? (
        <section className="delivery-primary-asset">
          <div className="delivery-image-heading">
            <div><small>CRIATIVO PRINCIPAL</small><strong>Imagem contextual pronta</strong></div>
            <span>IA + contexto da marca</span>
          </div>
          <img src={output.imageUrl} alt={output.imageAlt || output.title} loading="lazy" crossOrigin="anonymous" />
          <div className="delivery-image-footer">
            <p>{output.imageAlt || "Imagem produzida a partir do briefing e da direção visual."}</p>
            <AssetActions request={request} />
          </div>
        </section>
      ) : (
        <section className={`content-image-state ${output.imageStatus}`}>
          <small>CRIATIVO VISUAL</small>
          <strong>{output.imageStatus === "failed" ? "O texto está pronto, mas a imagem não foi concluída" : "Imagem ainda não gerada"}</strong>
          <p>O conteúdo permanece disponível para revisão. Uma nova entrega visual pode ser solicitada sem perder a estratégia.</p>
        </section>
      )}

      <section className="delivery-copy-card">
        <div className="delivery-copy-lead"><small>GANCHO</small><h3>{output.hook}</h3></div>
        <div className="delivery-copy-grid">
          <article><small>TÍTULO</small><p>{output.title}</p></article>
          <article><small>CHAMADA PARA AÇÃO</small><p>{output.cta}</p></article>
        </div>
        <article><small>LEGENDA</small><p className="content-caption">{output.caption}</p></article>
        <div className="content-hashtags">{output.hashtags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </section>

      <VisualSet request={request} />
      <FormatStructure request={request} />

      <details className="delivery-technical-details">
        <summary>Ver direção visual e orientações de adaptação</summary>
        <section><small>DIREÇÃO VISUAL</small><p>{output.visualDirection}</p></section>
        {output.adaptationNotes.length > 0 && (
          <section><small>NOTAS DE ADAPTAÇÃO</small><ul>{output.adaptationNotes.map((note) => <li key={note}>{note}</li>)}</ul></section>
        )}
      </details>
    </div>
  );
}
