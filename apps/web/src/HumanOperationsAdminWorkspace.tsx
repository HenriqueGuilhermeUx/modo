import { useEffect, useMemo, useState } from "react";
import { getAdminToken } from "./admin-api";
import {
  type AdminSpecialistApplication,
  type AdminSupportRequest,
  getHumanOperationsOverview,
  listAdminSpecialistApplications,
  listAdminSupportRequests,
  updateAdminSpecialistApplication,
  updateAdminSupportRequest,
} from "./human-operations-api";

type Tab = "support" | "talent";

const supportLabels: Record<AdminSupportRequest["status"], string> = {
  requested: "Recebido",
  triage: "Triagem",
  proposal: "Proposta",
  in_progress: "Em andamento",
  completed: "Concluído",
  declined: "Não disponível",
};

const talentLabels: Record<AdminSpecialistApplication["status"], string> = {
  received: "Recebido",
  under_review: "Em análise",
  approved: "Aprovado",
  talent_pool: "Banco curado",
  declined: "Não aderente",
};

const typeLabels: Record<string, string> = {
  strategy: "Estratégia",
  art_direction: "Direção de arte",
  copywriting: "Copywriting",
  design: "Design",
  motion: "Motion",
  video_editing: "Edição de vídeo",
  paid_media: "Mídia paga",
  campaign_review: "Revisão de campanha",
  full_management: "Gestão acompanhada",
  other: "Outro desafio",
};

export default function HumanOperationsAdminWorkspace() {
  const [tab, setTab] = useState<Tab>("support");
  const [overview, setOverview] = useState<{ support: Record<string, number>; talent: Record<string, number> }>({ support: {}, talent: {} });
  const [support, setSupport] = useState<AdminSupportRequest[]>([]);
  const [talent, setTalent] = useState<AdminSpecialistApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    const [nextOverview, nextSupport, nextTalent] = await Promise.all([
      getHumanOperationsOverview(),
      listAdminSupportRequests(),
      listAdminSpecialistApplications(),
    ]);
    setOverview(nextOverview);
    setSupport(nextSupport);
    setTalent(nextTalent);
  }

  useEffect(() => {
    if (!getAdminToken()) {
      window.location.href = "/admin";
      return;
    }
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir a operação humana."))
      .finally(() => setLoading(false));
  }, []);

  const filteredSupport = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return support;
    return support.filter((item) => [item.organizationName,item.brandName,item.requesterName,item.requesterEmail,item.context,item.type,item.status].some((value) => String(value).toLowerCase().includes(query)));
  }, [support, search]);

  const filteredTalent = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return talent;
    return talent.filter((item) => [item.name,item.email,item.city,item.primaryRole,item.about,item.status].some((value) => String(value).toLowerCase().includes(query)));
  }, [talent, search]);

  async function changeSupport(item: AdminSupportRequest, patch: Partial<AdminSupportRequest>) {
    setBusyId(item.id);
    setError("");
    setSuccess("");
    try {
      await updateAdminSupportRequest(item.id, {
        status: patch.status,
        pricingStatus: patch.pricingStatus,
        internalNotes: patch.internalNotes,
        assignedApplicationId: patch.assignedApplicationId,
      });
      await load();
      setSuccess("Pedido atualizado e registrado no histórico administrativo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o pedido.");
    } finally {
      setBusyId("");
    }
  }

  async function changeTalent(item: AdminSpecialistApplication, patch: Partial<AdminSpecialistApplication>) {
    setBusyId(item.id);
    setError("");
    setSuccess("");
    try {
      await updateAdminSpecialistApplication(item.id, { status: patch.status, internalNotes: patch.internalNotes });
      await load();
      setSuccess("Candidatura atualizada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a candidatura.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <main className="admin-login"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Abrindo a operação humana...</p></main>;

  const approvedTalent = talent.filter((item) => ["approved", "talent_pool"].includes(item.status));

  return (
    <div className="human-admin-shell">
      <header className="human-admin-header"><a href="/admin"><img src="/logo.svg" alt="MODO" /></a><nav><a href="/admin">Central</a><a className="active" href="/admin/rede">Rede Modo</a><a href="/admin/smartbots">SmartBots</a></nav><span>OPERAÇÃO INTERNA</span></header>
      <main className="human-admin-main">
        <section className="human-admin-hero"><div><small>REDE MODO</small><h1>Curadoria, triagem e acompanhamento.</h1><p>Prepare a camada humana sem transformar a Modo em marketplace aberto. Nenhuma atribuição cria contrato, cobrança ou acesso automático ao cliente.</p></div><div className="human-admin-stats"><article><strong>{overview.support.requested || 0}</strong><span>pedidos aguardando</span></article><article><strong>{overview.talent.received || 0}</strong><span>candidaturas novas</span></article><article><strong>{approvedTalent.length}</strong><span>talentos elegíveis</span></article></div></section>

        <div className="human-admin-toolbar"><div><button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}>Pedidos de clientes</button><button className={tab === "talent" ? "active" : ""} onClick={() => setTab("talent")}>Banco de profissionais</button></div><input placeholder="Buscar nome, marca, e-mail ou especialidade" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {tab === "support" && <section className="human-admin-list">
          {filteredSupport.map((item) => <article className={item.urgency === "priority" ? "priority" : ""} key={item.id}>
            <header><div><small>{item.organizationName} · {item.brandName}</small><h2>{typeLabels[item.type] || item.type}</h2><span>{item.requesterName} · {item.requesterEmail}</span></div><b>{supportLabels[item.status]}</b></header>
            <div className="human-admin-context"><strong>Desafio</strong><p>{item.context}</p>{item.desiredOutcome && <><strong>Resultado desejado</strong><p>{item.desiredOutcome}</p></>}</div>
            <div className="human-admin-fields"><label>Status<select value={item.status} disabled={busyId === item.id} onChange={(event) => void changeSupport(item, { status: event.target.value as AdminSupportRequest["status"] })}>{Object.entries(supportLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Preço/escopo<select value={item.pricingStatus} disabled={busyId === item.id} onChange={(event) => void changeSupport(item, { pricingStatus: event.target.value as AdminSupportRequest["pricingStatus"] })}><option value="under_review">Em análise</option><option value="proposal_required">Exige proposta</option><option value="included">Incluído</option><option value="not_available">Não disponível</option></select></label><label>Profissional<select value={item.assignedApplicationId || ""} disabled={busyId === item.id} onChange={(event) => void changeSupport(item, { assignedApplicationId: event.target.value || null })}><option value="">Ainda não atribuído</option>{approvedTalent.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.primaryRole}</option>)}</select></label></div>
            <label className="human-admin-note">Nota interna<textarea defaultValue={item.internalNotes} placeholder="Análise, riscos, próximo contato e premissas" onBlur={(event) => { if (event.target.value !== item.internalNotes) void changeSupport(item, { internalNotes: event.target.value }); }} /></label>
            <footer><span>{item.urgency === "priority" ? "⚑ Prioridade solicitada" : "Fluxo normal"}</span><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small>{item.contentRequestId && <a href={`/app/content?open=${item.contentRequestId}`}>Ver conteúdo relacionado</a>}</footer>
          </article>)}
          {!filteredSupport.length && <div className="strategy-empty"><strong>Nenhum pedido nesta visão.</strong><p>A fila ficará disponível quando clientes solicitarem apoio.</p></div>}
        </section>}

        {tab === "talent" && <section className="human-admin-list talent-list">
          {filteredTalent.map((item) => <article key={item.id}>
            <header><div><small>{item.city || "Local não informado"} · {item.experienceYears} ano(s)</small><h2>{item.name}</h2><span>{item.email}{item.whatsapp ? ` · ${item.whatsapp}` : ""}</span></div><b>{talentLabels[item.status]}</b></header>
            <div className="talent-admin-roles"><strong>{item.primaryRole}</strong>{item.secondaryRoles.map((role) => <span key={role}>{role}</span>)}</div><p className="talent-admin-about">{item.about}</p>
            <div className="human-admin-fields"><label>Status<select value={item.status} disabled={busyId === item.id} onChange={(event) => void changeTalent(item, { status: event.target.value as AdminSpecialistApplication["status"] })}>{Object.entries(talentLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Disponibilidade<input readOnly value={item.availability} /></label><label>Colaboração<input readOnly value={item.engagementPreference} /></label></div>
            <label className="human-admin-note">Nota de curadoria<textarea defaultValue={item.internalNotes} placeholder="Pontos fortes, aderência, segmentos e cuidados" onBlur={(event) => { if (event.target.value !== item.internalNotes) void changeTalent(item, { internalNotes: event.target.value }); }} /></label>
            <footer><a href={item.portfolioUrl} target="_blank" rel="noreferrer">Abrir portfólio ↗</a>{item.linkedinUrl && <a href={item.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn ↗</a>}<small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(item.createdAt))}</small></footer>
          </article>)}
          {!filteredTalent.length && <div className="strategy-empty"><strong>Nenhuma candidatura nesta visão.</strong><p>Os profissionais aparecerão aqui após enviarem o formulário público.</p></div>}
        </section>}
      </main>
    </div>
  );
}
