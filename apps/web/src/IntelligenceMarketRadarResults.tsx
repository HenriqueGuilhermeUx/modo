import type { IntelligenceMission } from "@modo/contracts/intelligence";

interface Props {
  mission: IntelligenceMission;
  items: Record<string, unknown>[];
  onClose: () => void;
}

interface RadarSignal {
  position: number;
  title: string;
  description: string;
  url: string;
  domain: string;
  searchQuery: string;
  signalType: string;
  relevanceScore: number;
}

const signalLabels: Record<string, string> = {
  concorrencia: "Concorrência",
  oferta: "Oferta",
  reputacao: "Reputação",
  tendencia: "Tendência",
  mercado: "Mercado",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function signalFromItem(item: Record<string, unknown>, index: number): RadarSignal {
  const url = safeUrl(text(item.url));
  let domain = text(item.domain);
  if (!domain && url) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }
  const signalType = text(item.signalType) || "mercado";
  return {
    position: Math.max(1, Math.trunc(number(item.position) || index + 1)),
    title: text(item.title) || `Sinal ${index + 1}`,
    description: text(item.description) || text(item.snippet),
    url,
    domain,
    searchQuery: text(item.searchQuery) || text(item.query),
    signalType,
    relevanceScore: Math.max(0, Math.min(100, Math.trunc(number(item.relevanceScore) || 50))),
  };
}

function csvCell(value: string | number) {
  return `"${String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

function exportCsv(mission: IntelligenceMission, signals: RadarSignal[]) {
  const headers = ["Posição", "Tipo", "Título", "Descrição", "Fonte", "Consulta", "Relevância", "URL"];
  const rows = signals.map((signal) => [
    signal.position,
    signalLabels[signal.signalType] || signal.signalType,
    signal.title,
    signal.description,
    signal.domain,
    signal.searchQuery,
    signal.relevanceScore,
    signal.url,
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = mission.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  link.href = url;
  link.download = `modo-radar-${slug || "mercado"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function IntelligenceMarketRadarResults({ mission, items, onClose }: Props) {
  const signals = items.map(signalFromItem);
  const sources = new Set(signals.map((signal) => signal.domain).filter(Boolean)).size;
  const trends = signals.filter((signal) => signal.signalType === "tendencia").length;
  const competitors = signals.filter((signal) => signal.signalType === "concorrencia").length;

  return (
    <section className="commercial-results radar-results">
      <div className="commercial-results-head">
        <div>
          <small>RADAR DE MERCADO</small>
          <h2>{mission.name}</h2>
          <p>Sinais públicos organizados para apoiar posicionamento, conteúdo, oferta e decisões comerciais.</p>
        </div>
        <div className="commercial-results-actions">
          <button type="button" className="secondary" onClick={() => exportCsv(mission, signals)} disabled={!signals.length}>Exportar CSV</button>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>

      <div className="commercial-results-summary">
        <article><small>SINAIS</small><strong>{signals.length}</strong><span>resultados orgânicos</span></article>
        <article><small>FONTES</small><strong>{sources}</strong><span>domínios distintos</span></article>
        <article><small>TENDÊNCIAS</small><strong>{trends}</strong><span>movimentos detectados</span></article>
        <article><small>CONCORRÊNCIA</small><strong>{competitors}</strong><span>referências diretas</span></article>
      </div>

      <div className="radar-grid">
        {signals.map((signal) => (
          <article key={`${signal.position}-${signal.url}-${signal.title}`}>
            <div className="radar-card-head">
              <span className={`radar-type type-${signal.signalType}`}>{signalLabels[signal.signalType] || signal.signalType}</span>
              <strong>{signal.relevanceScore}% relevante</strong>
            </div>
            <h3>{signal.title}</h3>
            <p>{signal.description || "O resultado não trouxe descrição. Abra a fonte para analisar o conteúdo."}</p>
            <div className="radar-meta">
              <span>{signal.domain || "Fonte não identificada"}</span>
              {signal.searchQuery && <span>Busca: {signal.searchQuery}</span>}
            </div>
            {signal.url && <a href={signal.url} target="_blank" rel="noreferrer">Abrir fonte ↗</a>}
          </article>
        ))}
      </div>

      {!signals.length && <div className="commercial-results-empty">Nenhum sinal de mercado foi encontrado nesta missão.</div>}
      <p className="commercial-compliance">O Radar organiza resultados públicos. Confirme o contexto e a atualidade diretamente nas fontes antes de tomar decisões.</p>

      <style>{`.radar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.radar-grid>article{border:1px solid #e1e7f0;border-radius:17px;padding:17px;background:#fbfcff;display:flex;flex-direction:column;min-height:230px}.radar-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.radar-card-head>strong{font-size:9px;color:#6f7b91}.radar-type{display:inline-flex;border-radius:999px;padding:6px 9px;background:#edf2ff;color:#1f5eff;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.radar-type.type-oferta{background:#fff1df;color:#9a5b00}.radar-type.type-reputacao{background:#fff0f0;color:#a52626}.radar-type.type-tendencia{background:#e8faf3;color:#087655}.radar-type.type-concorrencia{background:#f0eaff;color:#6941c6}.radar-grid h3{font:800 18px/1.25 Sora,sans-serif;margin:14px 0 8px}.radar-grid p{font-size:11px;line-height:1.55;color:#5d6980;margin:0 0 15px;flex:1}.radar-meta{display:grid;gap:4px;border-top:1px solid #e5eaf2;padding-top:11px}.radar-meta span{font-size:9px;color:#7b8699;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.radar-grid a{display:inline-flex;width:max-content;margin-top:11px;border-radius:9px;padding:8px 10px;background:#0d1b3e;color:#fff;font-size:9px;font-weight:900;text-decoration:none}@media(max-width:800px){.radar-grid{grid-template-columns:1fr}}`}</style>
    </section>
  );
}
