import { useEffect, useMemo, useState } from "react";
import { getAdminToken } from "./admin-api";
import {
  type AdminPartnerApplication,
  listAdminPartnerApplications,
  updateAdminPartnerApplication,
} from "./human-operations-api";

const statusLabels: Record<AdminPartnerApplication["status"], string> = {
  received: "Recebido",
  under_review: "Em análise",
  interview: "Entrevista",
  approved: "Aprovado",
  waitlist: "Waitlist",
  declined: "Não aderente",
};

const businessTypeLabels: Record<string, string> = {
  agency: "Agência",
  social_media: "Social media",
  paid_media: "Mídia paga",
  consultancy: "Consultoria",
  production_company: "Produtora/estúdio",
  freelancer: "Freelancer",
  other: "Outro",
};

function formatMoney(cents: number | null) {
  if (cents === null) return "Não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);
}

export default function PartnerAdminWorkspace() {
  const [applications, setApplications] = useState<AdminPartnerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AdminPartnerApplication["status"]>("all");

  async function load() {
    setApplications(await listAdminPartnerApplications());
  }

  useEffect(() => {
    if (!getAdminToken()) {
      window.location.href = "/admin";
      return;
    }
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir a fila de Partners."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applications.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!query) return true;
      return [
        item.name,
        item.email,
        item.whatsapp,
        item.companyName,
        item.city,
        item.businessType,
        item.currentServices.join(" "),
        item.whyPartner,
        item.status,
      ].some((value) => String(value).toLowerCase().includes(query));
    });
  }, [applications, search, statusFilter]);

  const counts = useMemo(() => Object.fromEntries(
    Object.keys(statusLabels).map((status) => [status, applications.filter((item) => item.status === status).length]),
  ) as Record<AdminPartnerApplication["status"], number>, [applications]);

  async function update(item: AdminPartnerApplication, patch: Partial<Pick<AdminPartnerApplication, "status" | "internalNotes">>) {
    setBusyId(item.id);
    setError("");
    setSuccess("");
    try {
      await updateAdminPartnerApplication(item.id, patch);
      await load();
      setSuccess("Candidatura de Partner atualizada e registrada no histórico administrativo.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a candidatura.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) {
    return <main className="admin-login"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Abrindo a seleção de MODO Partners...</p></main>;
  }

  return (
    <div className="human-admin-shell">
      <header className="human-admin-header">
        <a href="/admin"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/admin">Central</a><a href="/admin/rede">Time Modo</a><a className="active" href="/admin/partners">Partners</a><a href="/admin/smartbots">SmartBots</a></nav>
        <span>FOUNDING PROGRAM</span>
      </header>

      <main className="human-admin-main">
        <section className="human-admin-hero">
          <div><small>MODO PARTNER</small><h1>Seleção dos Founding Partners.</h1><p>Fila interna para avaliar operações que já atendem clientes, registrar a conversa de aderência e escolher os primeiros pilotos. Aprovação não cria contrato, assinatura Agency ou exclusividade automaticamente.</p></div>
          <div className="human-admin-stats">
            <article><strong>{counts.received || 0}</strong><span>novas candidaturas</span></article>
            <article><strong>{counts.interview || 0}</strong><span>em entrevista</span></article>
            <article><strong>{counts.approved || 0}</strong><span>aprovados</span></article>
          </div>
        </section>

        <div className="human-admin-toolbar">
          <div>
            <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>Todas</button>
            <button className={statusFilter === "received" ? "active" : ""} onClick={() => setStatusFilter("received")}>Novas</button>
            <button className={statusFilter === "interview" ? "active" : ""} onClick={() => setStatusFilter("interview")}>Entrevistas</button>
            <button className={statusFilter === "approved" ? "active" : ""} onClick={() => setStatusFilter("approved")}>Aprovados</button>
          </div>
          <input placeholder="Buscar empresa, responsável, serviço ou cidade" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className="human-admin-list talent-list">
          {filtered.map((item) => (
            <article key={item.id}>
              <header>
                <div>
                  <small>{businessTypeLabels[item.businessType] || item.businessType} · {item.city || "Local não informado"}</small>
                  <h2>{item.companyName}</h2>
                  <span>{item.name} · {item.email} · {item.whatsapp}</span>
                </div>
                <b>{statusLabels[item.status]}</b>
              </header>

              <div className="talent-admin-roles">
                <strong>{item.activeClients} cliente(s) ativo(s)</strong>
                <span>Meta MODO: {item.targetClientsWithModo}</span>
                <span>Receita serviços: {formatMoney(item.monthlyServiceRevenueCents)}</span>
              </div>

              <div className="human-admin-context">
                <strong>Serviços atuais</strong>
                <p>{item.currentServices.join(" · ")}</p>
                <strong>Por que quer ser MODO Partner</strong>
                <p>{item.whyPartner}</p>
              </div>

              <div className="human-admin-fields">
                <label>Status<select value={item.status} disabled={busyId === item.id} onChange={(event) => void update(item, { status: event.target.value as AdminPartnerApplication["status"] })}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>Carteira<input readOnly value={`${item.activeClients} ativos / ${item.targetClientsWithModo} pretendidos`} /></label>
                <label>Modelo<input readOnly value={businessTypeLabels[item.businessType] || item.businessType} /></label>
              </div>

              <label className="human-admin-note">Nota interna / scorecard<textarea defaultValue={item.internalNotes} placeholder="Pontuação, maturidade comercial, riscos, 3 clientes piloto, decisão e próximo passo" onBlur={(event) => { if (event.target.value !== item.internalNotes) void update(item, { internalNotes: event.target.value }); }} /></label>

              <footer>
                {item.websiteUrl && <a href={item.websiteUrl} target="_blank" rel="noreferrer">Abrir site ↗</a>}
                {item.instagramUrl && <a href={item.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}
                <a href={`mailto:${item.email}`}>Enviar e-mail ↗</a>
                <small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small>
              </footer>
            </article>
          ))}
          {!filtered.length && <div className="strategy-empty"><strong>Nenhum Partner nesta visão.</strong><p>Novas candidaturas aparecerão aqui automaticamente após o formulário público.</p></div>}
        </section>
      </main>
    </div>
  );
}
