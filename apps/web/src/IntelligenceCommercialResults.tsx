import type { IntelligenceMission } from "@modo/contracts/intelligence";

interface Props {
  mission: IntelligenceMission;
  items: Record<string, unknown>[];
  onClose: () => void;
}

interface CommercialLead {
  position: number;
  businessName: string;
  category: string;
  phone: string;
  website: string;
  rating: number;
  reviewsCount: number;
  address: string;
  city: string;
  state: string;
  mapsUrl: string;
  qualityScore: number;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function leadFromItem(item: Record<string, unknown>, index: number): CommercialLead {
  return {
    position: number(item.position) || index + 1,
    businessName: text(item.businessName) || text(item.title) || `Empresa ${index + 1}`,
    category: text(item.category) || text(item.categoryName),
    phone: text(item.phone),
    website: text(item.website),
    rating: number(item.rating) || number(item.totalScore),
    reviewsCount: number(item.reviewsCount),
    address: text(item.address) || text(item.street),
    city: text(item.city),
    state: text(item.state),
    mapsUrl: text(item.mapsUrl) || text(item.url),
    qualityScore: Math.max(0, Math.min(100, number(item.qualityScore))),
  };
}

function whatsappUrl(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`;
}

function safeExternalUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function csvCell(value: string | number) {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${normalized.replace(/"/g, '""')}"`;
}

function exportCsv(mission: IntelligenceMission, leads: CommercialLead[]) {
  const headers = [
    "Posição",
    "Empresa",
    "Categoria",
    "Telefone",
    "Site",
    "Avaliação",
    "Avaliações",
    "Endereço",
    "Cidade",
    "Estado",
    "Qualidade",
    "Google Maps",
  ];
  const rows = leads.map((lead) => [
    lead.position,
    lead.businessName,
    lead.category,
    lead.phone,
    lead.website,
    lead.rating,
    lead.reviewsCount,
    lead.address,
    lead.city,
    lead.state,
    lead.qualityScore,
    lead.mapsUrl,
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = mission.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.href = url;
  link.download = `modo-${slug || "inteligencia"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function qualityLabel(score: number) {
  if (score >= 90) return "Excelente";
  if (score >= 70) return "Boa";
  if (score >= 50) return "Parcial";
  return "Baixa";
}

export default function IntelligenceCommercialResults({ mission, items, onClose }: Props) {
  const leads = items.map(leadFromItem);
  const withPhone = leads.filter((lead) => lead.phone).length;
  const withWebsite = leads.filter((lead) => lead.website).length;
  const highQuality = leads.filter((lead) => lead.qualityScore >= 90).length;

  return (
    <section className="commercial-results">
      <div className="commercial-results-head">
        <div>
          <small>LISTA COMERCIAL</small>
          <h2>{mission.name}</h2>
          <p>{leads.length} empresas encontradas e organizadas para análise comercial.</p>
        </div>
        <div className="commercial-results-actions">
          <button type="button" className="secondary" onClick={() => exportCsv(mission, leads)} disabled={!leads.length}>Exportar CSV</button>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>

      <div className="commercial-results-summary">
        <article><small>EMPRESAS</small><strong>{leads.length}</strong><span>na missão</span></article>
        <article><small>COM TELEFONE</small><strong>{withPhone}</strong><span>contatos públicos</span></article>
        <article><small>COM SITE</small><strong>{withWebsite}</strong><span>presença digital</span></article>
        <article><small>QUALIDADE ALTA</small><strong>{highQuality}</strong><span>pontuação 90+</span></article>
      </div>

      <div className="commercial-results-table-wrap">
        <table className="commercial-results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Empresa</th>
              <th>Contato</th>
              <th>Avaliação</th>
              <th>Endereço</th>
              <th>Qualidade</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const whatsapp = whatsappUrl(lead.phone);
              const website = safeExternalUrl(lead.website);
              const maps = safeExternalUrl(lead.mapsUrl);
              return (
                <tr key={`${lead.position}-${lead.businessName}-${lead.phone}`}>
                  <td data-label="#"><span className="position">{lead.position}</span></td>
                  <td data-label="Empresa">
                    <strong>{lead.businessName}</strong>
                    <small>{lead.category || "Categoria não informada"}</small>
                  </td>
                  <td data-label="Contato">
                    <strong>{lead.phone || "Sem telefone"}</strong>
                    <small>{lead.website ? "Site disponível" : "Sem site informado"}</small>
                  </td>
                  <td data-label="Avaliação">
                    <strong>{lead.rating ? lead.rating.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}</strong>
                    <small>{lead.reviewsCount} avaliações</small>
                  </td>
                  <td data-label="Endereço">
                    <strong>{lead.address || "Não informado"}</strong>
                    <small>{[lead.city, lead.state].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td data-label="Qualidade">
                    <span className={`quality quality-${lead.qualityScore >= 90 ? "high" : lead.qualityScore >= 70 ? "good" : "low"}`}>
                      {lead.qualityScore}
                    </span>
                    <small>{qualityLabel(lead.qualityScore)}</small>
                  </td>
                  <td data-label="Ações">
                    <div className="lead-actions">
                      {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
                      {website && <a href={website} target="_blank" rel="noreferrer">Site</a>}
                      {maps && <a href={maps} target="_blank" rel="noreferrer">Maps</a>}
                      {!whatsapp && !website && !maps && <span>Sem links</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!leads.length && <div className="commercial-results-empty">Nenhum registro comercial foi encontrado nesta missão.</div>}

      <style>{`.commercial-results{background:#fff;border:1px solid #dfe6f1;border-radius:24px;padding:26px;margin-top:18px;color:#0d1b3e}.commercial-results-head{display:flex;align-items:flex-start;justify-content:space-between;gap:25px}.commercial-results-head small,.commercial-results-summary small{font-size:9px;letter-spacing:.13em;font-weight:900;color:#1f5eff}.commercial-results-head h2{font:800 30px Sora,sans-serif;margin:7px 0}.commercial-results-head p{color:#5b657a;margin:0}.commercial-results-actions{display:flex;gap:8px}.commercial-results-actions button{border:0;border-radius:10px;padding:11px 14px;background:#0d1b3e;color:#fff;font-weight:800;cursor:pointer}.commercial-results-actions button.secondary{background:#eaf0ff;color:#1f5eff}.commercial-results-actions button:disabled{opacity:.5;cursor:not-allowed}.commercial-results-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.commercial-results-summary article{background:#f6f8fc;border:1px solid #e4e9f2;border-radius:15px;padding:15px;display:grid;gap:4px}.commercial-results-summary strong{font:800 27px Sora,sans-serif}.commercial-results-summary span{font-size:10px;color:#6b7589}.commercial-results-table-wrap{overflow:auto;border:1px solid #e1e7f0;border-radius:16px}.commercial-results-table{width:100%;border-collapse:collapse;min-width:1060px}.commercial-results-table th{background:#f5f7fb;color:#68748b;text-align:left;font-size:9px;letter-spacing:.08em;padding:12px;border-bottom:1px solid #e1e7f0}.commercial-results-table td{padding:13px 12px;border-bottom:1px solid #edf1f6;vertical-align:top;font-size:12px}.commercial-results-table tbody tr:last-child td{border-bottom:0}.commercial-results-table td>strong{display:block;max-width:230px}.commercial-results-table td>small{display:block;color:#7a8498;margin-top:4px;max-width:230px}.position{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#edf2ff;color:#1f5eff;font-weight:900}.quality{display:inline-grid;place-items:center;min-width:42px;height:29px;padding:0 7px;border-radius:999px;font-weight:900;background:#fff1e8;color:#a34c15}.quality-high{background:#e5f9f0;color:#087655}.quality-good{background:#eaf0ff;color:#1f5eff}.lead-actions{display:flex;flex-wrap:wrap;gap:6px;max-width:190px}.lead-actions a{display:inline-flex;border-radius:8px;padding:7px 9px;background:#0d1b3e;color:#fff;font-size:9px;font-weight:900;text-decoration:none}.lead-actions a:first-child{background:#e4f8ef;color:#087655}.lead-actions span{color:#8a94a7;font-size:10px}.commercial-results-empty{text-align:center;padding:35px;color:#6b7589}.commercial-results-table tbody tr:hover{background:#fbfcff}@media(max-width:800px){.commercial-results-head{flex-direction:column}.commercial-results-actions{width:100%}.commercial-results-actions button{flex:1}.commercial-results-summary{grid-template-columns:1fr 1fr}}@media(max-width:520px){.commercial-results-summary{grid-template-columns:1fr}.commercial-results{padding:16px}}`}</style>
    </section>
  );
}
