import type { IntelligenceMission } from "@modo/contracts/intelligence";
import { useEffect, useMemo, useState } from "react";
import {
  updateIntelligenceLead,
  type IntelligenceLeadItem,
  type IntelligenceLeadPriority,
  type IntelligenceLeadStatus,
} from "./intelligence-api";

interface Props {
  mission: IntelligenceMission;
  items: IntelligenceLeadItem[];
  onClose: () => void;
}

interface CommercialLead extends IntelligenceLeadItem {
  position: number;
}

const statusLabels: Record<IntelligenceLeadStatus, string> = {
  new: "Novo",
  qualified: "Qualificado",
  contacted: "Contatado",
  negotiating: "Negociando",
  won: "Ganho",
  lost: "Perdido",
  archived: "Arquivado",
};

const priorityLabels: Record<IntelligenceLeadPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

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
    "Status comercial",
    "Prioridade",
    "Anotações",
    "Apareceu em missões",
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
    statusLabels[lead.pipelineStatus],
    priorityLabels[lead.priority],
    lead.notes,
    lead.occurrenceCount,
    lead.mapsUrl,
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

function searchable(lead: CommercialLead) {
  return [lead.businessName, lead.category, lead.phone, lead.city, lead.state, lead.notes]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function IntelligenceLeadPipeline({ mission, items, onClose }: Props) {
  const [leads, setLeads] = useState<CommercialLead[]>(items);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | IntelligenceLeadStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | IntelligenceLeadPriority>("all");
  const [savingId, setSavingId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLeads(items);
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
  }, [items]);

  const filteredLeads = useMemo(() => {
    const term = search
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.pipelineStatus !== statusFilter) return false;
      if (priorityFilter !== "all" && lead.priority !== priorityFilter) return false;
      if (term && !searchable(lead).includes(term)) return false;
      return true;
    });
  }, [leads, priorityFilter, search, statusFilter]);

  const withPhone = leads.filter((lead) => lead.phone).length;
  const activePipeline = leads.filter((lead) =>
    ["qualified", "contacted", "negotiating"].includes(lead.pipelineStatus),
  ).length;
  const won = leads.filter((lead) => lead.pipelineStatus === "won").length;

  async function persist(
    lead: CommercialLead,
    patch: Partial<Pick<IntelligenceLeadItem, "pipelineStatus" | "priority" | "notes">>,
  ) {
    if (!lead.leadId) return;
    setSavingId(lead.leadId);
    setFeedback("");
    setError("");
    try {
      const updated = await updateIntelligenceLead(lead.leadId, patch);
      setLeads((current) => current.map((item) => item.leadId === lead.leadId
        ? { ...item, ...updated, position: item.position }
        : item));
      setFeedback(`${lead.businessName} atualizado.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o lead.");
    } finally {
      setSavingId("");
    }
  }

  function updateLocalNotes(id: string, notes: string) {
    setLeads((current) => current.map((lead) => lead.leadId === id ? { ...lead, notes } : lead));
  }

  return (
    <section className="commercial-results">
      <div className="commercial-results-head">
        <div>
          <small>FUNIL COMERCIAL</small>
          <h2>{mission.name}</h2>
          <p>{leads.length} empresas deduplicadas e prontas para acompanhamento manual.</p>
        </div>
        <div className="commercial-results-actions">
          <button type="button" className="secondary" onClick={() => exportCsv(mission, filteredLeads)} disabled={!filteredLeads.length}>Exportar filtrados</button>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
      </div>

      <div className="commercial-results-summary">
        <article><small>EMPRESAS</small><strong>{leads.length}</strong><span>deduplicadas</span></article>
        <article><small>COM TELEFONE</small><strong>{withPhone}</strong><span>contatos públicos</span></article>
        <article><small>EM ANDAMENTO</small><strong>{activePipeline}</strong><span>qualificados ou contatados</span></article>
        <article><small>GANHOS</small><strong>{won}</strong><span>oportunidades convertidas</span></article>
      </div>

      <div className="commercial-results-filters">
        <label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Empresa, cidade, telefone ou anotação" /></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | IntelligenceLeadStatus)}><option value="all">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Prioridade<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | IntelligenceLeadPriority)}><option value="all">Todas</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div><strong>{filteredLeads.length}</strong><span>visíveis</span></div>
      </div>

      {feedback && <div className="commercial-feedback success">{feedback}</div>}
      {error && <div className="commercial-feedback error">{error}</div>}

      <div className="commercial-results-table-wrap">
        <table className="commercial-results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Empresa</th>
              <th>Contato</th>
              <th>Sinais</th>
              <th>Pipeline</th>
              <th>Anotações</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => {
              const whatsapp = whatsappUrl(lead.phone);
              const website = safeExternalUrl(lead.website);
              const maps = safeExternalUrl(lead.mapsUrl);
              const saving = savingId === lead.leadId;
              return (
                <tr key={lead.leadId || `${lead.position}-${lead.businessName}-${lead.phone}`}>
                  <td><span className="position">{lead.position}</span></td>
                  <td>
                    <strong>{lead.businessName}</strong>
                    <small>{lead.category || "Categoria não informada"}</small>
                    {lead.occurrenceCount > 1 && <span className="duplicate-badge">Encontrado em {lead.occurrenceCount} missões</span>}
                  </td>
                  <td>
                    <strong>{lead.phone || "Sem telefone"}</strong>
                    <small>{lead.website ? "Site disponível" : "Sem site informado"}</small>
                    <small>{[lead.city, lead.state].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td>
                    <div className="signal-row"><span className={`quality quality-${lead.qualityScore >= 90 ? "high" : lead.qualityScore >= 70 ? "good" : "low"}`}>{lead.qualityScore}</span><small>{qualityLabel(lead.qualityScore)}</small></div>
                    <strong>{lead.rating ? `${lead.rating.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★` : "Sem nota"}</strong>
                    <small>{lead.reviewsCount} avaliações</small>
                  </td>
                  <td>
                    <label className="inline-field">Status<select value={lead.pipelineStatus} disabled={saving || !lead.leadId} onChange={(event) => void persist(lead, { pipelineStatus: event.target.value as IntelligenceLeadStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="inline-field">Prioridade<select value={lead.priority} disabled={saving || !lead.leadId} onChange={(event) => void persist(lead, { priority: event.target.value as IntelligenceLeadPriority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </td>
                  <td>
                    <textarea value={lead.notes} maxLength={2000} onChange={(event) => updateLocalNotes(lead.leadId, event.target.value)} placeholder="Ex.: falar com o proprietário na terça" />
                    <button type="button" className="note-save" disabled={saving || !lead.leadId} onClick={() => void persist(lead, { notes: lead.notes })}>{saving ? "Salvando..." : "Salvar nota"}</button>
                  </td>
                  <td>
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

      {!filteredLeads.length && <div className="commercial-results-empty">Nenhum lead corresponde aos filtros selecionados.</div>}
      <p className="commercial-compliance">A Modo organiza dados comerciais públicos. A abordagem continua manual e deve respeitar contexto, finalidade e regras aplicáveis.</p>

      <style>{`.commercial-results{background:#fff;border:1px solid #dfe6f1;border-radius:24px;padding:26px;margin-top:18px;color:#0d1b3e}.commercial-results-head{display:flex;align-items:flex-start;justify-content:space-between;gap:25px}.commercial-results-head small,.commercial-results-summary small{font-size:9px;letter-spacing:.13em;font-weight:900;color:#1f5eff}.commercial-results-head h2{font:800 30px Sora,sans-serif;margin:7px 0}.commercial-results-head p{color:#5b657a;margin:0}.commercial-results-actions{display:flex;gap:8px}.commercial-results-actions button{border:0;border-radius:10px;padding:11px 14px;background:#0d1b3e;color:#fff;font-weight:800;cursor:pointer}.commercial-results-actions button.secondary{background:#eaf0ff;color:#1f5eff}.commercial-results-actions button:disabled{opacity:.5;cursor:not-allowed}.commercial-results-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:22px 0}.commercial-results-summary article{background:#f6f8fc;border:1px solid #e4e9f2;border-radius:15px;padding:15px;display:grid;gap:4px}.commercial-results-summary strong{font:800 27px Sora,sans-serif}.commercial-results-summary span{font-size:10px;color:#6b7589}.commercial-results-filters{display:grid;grid-template-columns:1.4fr .7fr .7fr .35fr;gap:9px;align-items:end;margin-bottom:12px}.commercial-results-filters label{display:grid;gap:5px;font-size:9px;font-weight:900;color:#68748b}.commercial-results-filters input,.commercial-results-filters select{width:100%;box-sizing:border-box;border:1px solid #dce3ee;border-radius:10px;padding:10px;background:#fbfcfe;color:#0d1b3e}.commercial-results-filters>div{display:grid;place-items:center;background:#eef3ff;border-radius:11px;padding:9px}.commercial-results-filters>div strong{font:800 18px Sora,sans-serif;color:#1f5eff}.commercial-results-filters>div span{font-size:8px;color:#68748b}.commercial-feedback{border-radius:11px;padding:10px 12px;margin-bottom:10px;font-size:11px}.commercial-feedback.success{background:#e9fbf4;color:#087655}.commercial-feedback.error{background:#fff0f0;color:#a52626}.commercial-results-table-wrap{overflow:auto;border:1px solid #e1e7f0;border-radius:16px}.commercial-results-table{width:100%;border-collapse:collapse;min-width:1340px}.commercial-results-table th{background:#f5f7fb;color:#68748b;text-align:left;font-size:9px;letter-spacing:.08em;padding:12px;border-bottom:1px solid #e1e7f0}.commercial-results-table td{padding:13px 12px;border-bottom:1px solid #edf1f6;vertical-align:top;font-size:12px}.commercial-results-table tbody tr:last-child td{border-bottom:0}.commercial-results-table td>strong{display:block;max-width:220px}.commercial-results-table td>small{display:block;color:#7a8498;margin-top:4px;max-width:220px}.position{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#edf2ff;color:#1f5eff;font-weight:900}.duplicate-badge{display:inline-block;margin-top:7px;background:#fff2d9;color:#8a5b00;border-radius:999px;padding:5px 7px;font-size:8px;font-weight:900}.signal-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}.signal-row small{color:#7a8498}.quality{display:inline-grid;place-items:center;min-width:42px;height:29px;padding:0 7px;border-radius:999px;font-weight:900;background:#fff1e8;color:#a34c15}.quality-high{background:#e5f9f0;color:#087655}.quality-good{background:#eaf0ff;color:#1f5eff}.inline-field{display:grid;gap:3px;margin-bottom:7px;font-size:8px;font-weight:900;color:#7a8498}.inline-field select{border:1px solid #dce3ee;border-radius:8px;padding:7px;background:#fff;color:#0d1b3e;min-width:130px}.commercial-results-table textarea{width:220px;min-height:66px;box-sizing:border-box;border:1px solid #dce3ee;border-radius:9px;padding:8px;resize:vertical;font:500 11px Inter,sans-serif}.note-save{display:block;margin-top:5px;border:0;border-radius:8px;padding:7px 9px;background:#eaf0ff;color:#1f5eff;font-size:9px;font-weight:900;cursor:pointer}.note-save:disabled{opacity:.5;cursor:not-allowed}.lead-actions{display:flex;flex-wrap:wrap;gap:6px;max-width:190px}.lead-actions a{display:inline-flex;border-radius:8px;padding:7px 9px;background:#0d1b3e;color:#fff;font-size:9px;font-weight:900;text-decoration:none}.lead-actions a:first-child{background:#e4f8ef;color:#087655}.lead-actions span{color:#8a94a7;font-size:10px}.commercial-results-empty{text-align:center;padding:35px;color:#6b7589}.commercial-results-table tbody tr:hover{background:#fbfcff}.commercial-compliance{font-size:10px;color:#7a8498;line-height:1.5;margin:12px 2px 0}@media(max-width:900px){.commercial-results-head{flex-direction:column}.commercial-results-actions{width:100%}.commercial-results-actions button{flex:1}.commercial-results-summary{grid-template-columns:1fr 1fr}.commercial-results-filters{grid-template-columns:1fr 1fr}.commercial-results-filters label:first-child{grid-column:1/-1}}@media(max-width:520px){.commercial-results-summary,.commercial-results-filters{grid-template-columns:1fr}.commercial-results-filters label:first-child{grid-column:auto}.commercial-results{padding:16px}}`}</style>
    </section>
  );
}
