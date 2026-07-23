import type { SmartBotsIntake, SmartBotsIntakeStatus } from "@modo/contracts/smartbots";
import { useEffect, useState } from "react";
import { getAdminToken } from "./admin-api";
import { listAdminSmartBotsIntakes, updateAdminSmartBotsStatus } from "./smartbots-api";

const statusLabels: Record<SmartBotsIntakeStatus, string> = {
  submitted: "Recebido",
  sent: "Encaminhado",
  setup_in_progress: "Em implantação",
  ready: "Pronto",
  failed: "Revisar",
};

export default function SmartBotsAdminWorkspace() {
  const [items, setItems] = useState<SmartBotsIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setItems(await listAdminSmartBotsIntakes());
  }

  useEffect(() => {
    if (!getAdminToken()) {
      window.location.href = "/admin";
      return;
    }
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar a fila."))
      .finally(() => setLoading(false));
  }, []);

  async function changeStatus(item: SmartBotsIntake) {
    const status = window.prompt(
      "Status: submitted, sent, setup_in_progress, ready ou failed",
      item.status,
    )?.trim() as SmartBotsIntakeStatus | undefined;
    if (!status || !["submitted", "sent", "setup_in_progress", "ready", "failed"].includes(status)) return;
    const note = window.prompt("Observação para o cliente ou para a equipe:", item.providerMessage || "") ?? "";
    setBusy(item.id);
    setError("");
    try {
      await updateAdminSmartBotsStatus(item.id, status, note);
      await load();
      setSuccess(`Status de ${item.businessName} atualizado.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o pedido.");
    } finally {
      setBusy("");
    }
  }

  function copyBriefing(item: SmartBotsIntake) {
    const text = [
      `Empresa: ${item.businessName}`,
      `Responsável: ${item.ownerName}`,
      `E-mail: ${item.email}`,
      `WhatsApp: ${item.phone}`,
      `Instagram: ${item.instagram}`,
      `Segmento: ${item.segment}`,
      `Serviços: ${item.services}`,
      `Horários: ${item.openingHours}`,
      `FAQ: ${item.faq}`,
      `Preços: ${item.prices}`,
      `Mensagem inicial: ${item.welcomeMessage}`,
      `Google avaliações: ${item.googleReviewLink}`,
      `Notas: ${item.notes}`,
      `Partner: modo`,
      `Plan: presenca`,
    ].join("\n");
    return navigator.clipboard.writeText(text).then(() => setSuccess("Briefing copiado."));
  }

  if (loading) return <main className="smartbots-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Carregando implantações...</p></main>;

  return (
    <div className="smartbots-admin-shell">
      <header><a href="/admin"><img src="/logo.svg" alt="MODO" /></a><div><small>MODO CONTROL</small><strong>Implantações SmartBots Assistido</strong></div><a href="/admin">Voltar ao admin</a></header>
      <main>
        <section className="smartbots-admin-hero"><div><span>FILA DO MODO PRESENÇA</span><h1>Briefings para implantação assistida.</h1><p>Revise os dados, copie para a equipe e atualize o status que o cliente acompanha.</p></div><aside><strong>{items.length}</strong><span>pedido(s)</span></aside></section>
        {error && <div className="portal-error portal-error-wide">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}
        <section className="smartbots-admin-list">
          {items.map((item) => (
            <article key={item.id}>
              <div className="smartbots-admin-card-head"><div><small>{item.segment}</small><h2>{item.businessName}</h2><p>{item.ownerName} · {item.email} · {item.phone}</p></div><span className={`status-${item.status}`}>{statusLabels[item.status]}</span></div>
              <div className="smartbots-admin-card-grid"><div><small>SERVIÇOS</small><p>{item.services}</p></div><div><small>MENSAGEM INICIAL</small><p>{item.welcomeMessage}</p></div><div><small>FAQ</small><p>{item.faq || "Não informado"}</p></div><div><small>PREÇOS E HORÁRIOS</small><p>{item.prices || "Preços não informados"}<br />{item.openingHours || "Horários não informados"}</p></div></div>
              {item.providerMessage && <div className="smartbots-admin-note">{item.providerMessage}</div>}
              <footer><small>Atualizado em {new Date(item.updatedAt).toLocaleString("pt-BR")}</small><div><button onClick={() => void copyBriefing(item)}>Copiar briefing</button><button disabled={busy === item.id} onClick={() => void changeStatus(item)}>{busy === item.id ? "Atualizando..." : "Atualizar status"}</button></div></footer>
            </article>
          ))}
          {!items.length && <div className="smartbots-admin-empty"><strong>Nenhuma implantação na fila.</strong><p>Os briefings enviados pelo onboarding SmartBots aparecerão aqui.</p></div>}
        </section>
      </main>
      <style>{`.smartbots-admin-shell{min-height:100vh;background:#f4f7fb;color:#0d1b3e}.smartbots-admin-shell>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px max(20px,calc((100vw - 1380px)/2));background:#fff;border-bottom:1px solid #dfe6f1}.smartbots-admin-shell header img{width:115px}.smartbots-admin-shell header>div{display:grid;gap:3px}.smartbots-admin-shell header small{font-size:9px;color:#1f5eff;font-weight:900}.smartbots-admin-shell header>a:last-child{font-size:12px;font-weight:800;color:#1f5eff}.smartbots-admin-shell>main{width:min(1200px,calc(100% - 40px));margin:0 auto;padding:55px 0}.smartbots-admin-hero{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:25px}.smartbots-admin-hero span{font-size:9px;color:#1f5eff;font-weight:900}.smartbots-admin-hero h1{font:800 52px/1.05 Sora,sans-serif;letter-spacing:-.05em;margin:10px 0}.smartbots-admin-hero p{color:#5b657a}.smartbots-admin-hero aside{background:#0d1b3e;color:#fff;border-radius:18px;padding:20px;display:grid;text-align:center}.smartbots-admin-hero aside strong{font:800 36px Sora,sans-serif}.smartbots-admin-list{display:grid;gap:14px}.smartbots-admin-list>article{background:#fff;border:1px solid #dfe6f1;border-radius:22px;padding:24px}.smartbots-admin-card-head{display:flex;justify-content:space-between;gap:20px}.smartbots-admin-card-head small,.smartbots-admin-card-grid small{font-size:8px;letter-spacing:.12em;color:#1f5eff;font-weight:900}.smartbots-admin-card-head h2{font:800 26px Sora,sans-serif;margin:5px 0}.smartbots-admin-card-head p{margin:0;color:#5b657a;font-size:12px}.smartbots-admin-card-head>span{height:max-content;border-radius:999px;padding:8px 12px;font-size:10px;font-weight:900;background:#fff3d8;color:#8a5b00}.smartbots-admin-card-head>span.status-ready{background:#e9fbf4;color:#087655}.smartbots-admin-card-head>span.status-failed{background:#fff0f0;color:#a52626}.smartbots-admin-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}.smartbots-admin-card-grid>div{background:#f7f9fc;border-radius:13px;padding:14px}.smartbots-admin-card-grid p{white-space:pre-wrap;color:#4e5b73;line-height:1.5;font-size:12px}.smartbots-admin-note{background:#eef3ff;border-radius:12px;padding:13px;color:#394b6b;font-size:12px}.smartbots-admin-list footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:16px}.smartbots-admin-list footer small{color:#5b657a}.smartbots-admin-list footer div{display:flex;gap:8px}.smartbots-admin-list button{border:0;border-radius:10px;padding:10px 13px;background:#0d1b3e;color:#fff;font-weight:800;cursor:pointer}.smartbots-admin-list button:first-child{background:#eaf0ff;color:#1f5eff}.smartbots-admin-empty{background:#fff;border:1px dashed #cbd7ea;border-radius:20px;padding:45px;text-align:center}.smartbots-admin-empty p{color:#5b657a}@media(max-width:700px){.smartbots-admin-hero,.smartbots-admin-card-head,.smartbots-admin-list footer{align-items:flex-start;flex-direction:column}.smartbots-admin-card-grid{grid-template-columns:1fr}.smartbots-admin-list footer div{width:100%}.smartbots-admin-list button{flex:1}}`}</style>
    </div>
  );
}
