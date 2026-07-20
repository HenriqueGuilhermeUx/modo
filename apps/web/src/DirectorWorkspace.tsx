import type { ContentUnitType, Dashboard } from "@modo/contracts";
import type {
  CreativeChannel,
  CreativeProfile,
  CreativeRecommendation,
} from "@modo/contracts/creative-intelligence";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  generateCreativePlan,
  getCreativeProfile,
  listCreativeRecommendations,
  recordCreativeFeedback,
  saveCreativeProfile,
  setCreativeRecommendationStatus,
} from "./director-api";

const channelLabels: Record<CreativeChannel, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  reels: "Reels",
  stories: "Stories",
  youtube_shorts: "YouTube Shorts",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  blog: "Blog",
  email: "E-mail",
  website: "Site",
};

const kindLabels: Record<CreativeRecommendation["kind"], string> = {
  create: "A MODO cria",
  capture: "A MODO dirige",
  campaign: "Campanha",
  repurpose: "Reaproveitamento",
};

const allChannels = Object.keys(channelLabels) as CreativeChannel[];

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function text(value: string[]) {
  return value.join("\n");
}

function contentTypeFor(item: CreativeRecommendation): ContentUnitType {
  if (item.kind === "capture") return "short_video_script";
  if (item.kind === "campaign") return "carousel";
  if (item.kind === "repurpose") return "channel_adaptation";
  return "static_post";
}

function firstChannel(item: CreativeRecommendation) {
  return channelLabels[item.channels[0] || "instagram"];
}

export default function DirectorWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [brandId, setBrandId] = useState("");
  const [profile, setProfile] = useState<CreativeProfile | null>(null);
  const [recommendations, setRecommendations] = useState<CreativeRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    void getDashboard()
      .then((current) => {
        setDashboard(current);
        setBrandId(current.brands[0]?.id || "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o Diretor."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setLoading(true);
    Promise.all([getCreativeProfile(brandId), listCreativeRecommendations(brandId)])
      .then(([currentProfile, currentRecommendations]) => {
        setProfile(currentProfile);
        setRecommendations(currentRecommendations);
        setError("");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar a inteligência da marca."))
      .finally(() => setLoading(false));
  }, [brandId]);

  const brand = useMemo(
    () => dashboard?.brands.find((item) => item.id === brandId),
    [dashboard, brandId],
  );

  function patchProfile(patch: Partial<CreativeProfile>) {
    setProfile((current) => current ? { ...current, ...patch } : current);
  }

  async function handleSaveProfile() {
    if (!profile) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveCreativeProfile({
        brandId: profile.brandId,
        peopleAvailable: profile.peopleAvailable,
        comfortableOnCamera: profile.comfortableOnCamera,
        weeklyMinutesAvailable: profile.weeklyMinutesAvailable,
        locations: profile.locations,
        productsOrServicesToShow: profile.productsOrServicesToShow,
        proofAvailable: profile.proofAvailable,
        recurringQuestions: profile.recurringQuestions,
        currentPriorities: profile.currentPriorities,
        prohibitedTopics: profile.prohibitedTopics,
        preferredChannels: profile.preferredChannels,
        notes: profile.notes,
      });
      setProfile(saved);
      setSuccess("Memória criativa atualizada. As próximas sugestões usarão este contexto.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a memória.");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    if (!brandId) return;
    setGenerating(true);
    setError("");
    setSuccess("");
    try {
      const plan = await generateCreativePlan(brandId);
      setRecommendations(plan.recommendations);
      setSuccess("Novo plano criado com campanhas, conteúdos e missões executáveis.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o plano.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleStatus(item: CreativeRecommendation, status: "accepted" | "dismissed" | "completed") {
    setActionId(item.id);
    setError("");
    try {
      const updated = await setCreativeRecommendationStatus(item.id, status);
      setRecommendations((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      await recordCreativeFeedback(item.brandId, {
        recommendationId: item.id,
        signal: status === "dismissed" ? "dismissed" : "accepted",
      });
      setSuccess(status === "dismissed" ? "A MODO aprendeu que esta direção não é prioridade agora." : "Direção registrada na memória criativa.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar sua decisão.");
    } finally {
      setActionId("");
    }
  }

  async function takeToProduction(item: CreativeRecommendation) {
    await handleStatus(item, "accepted");
    window.sessionStorage.setItem("modo.directorPrefill", JSON.stringify({
      brandId: item.brandId,
      contentType: contentTypeFor(item),
      objective: item.objective,
      channel: firstChannel(item),
      brief: item.brief,
      recommendationId: item.id,
    }));
    window.location.href = "/app/content";
  }

  async function copyMission(item: CreativeRecommendation) {
    const mission = item.captureMission;
    if (!mission) return;
    const content = [
      item.title,
      `Objetivo: ${item.expectedOutcome}`,
      `Quem aparece: ${mission.person}`,
      `Tempo necessário: ${mission.estimatedMinutes} minutos`,
      `Local: ${mission.location}`,
      `Duração: ${mission.duration}`,
      `Enquadramento: ${mission.framing}`,
      `Abertura: ${mission.openingLine}`,
      "Estrutura:",
      ...mission.structure.map((step, index) => `${index + 1}. ${step}`),
      "Imagens de apoio:",
      ...mission.bRoll.map((step) => `- ${step}`),
      "Checklist:",
      ...mission.checklist.map((step) => `- ${step}`),
    ].join("\n");
    await navigator.clipboard.writeText(content);
    setSuccess("Missão copiada. Ela pode ser enviada para quem vai gravar.");
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando a inteligência criativa...</p></main>;
  }

  if (!dashboard) {
    return <main className="portal-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="director-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a className="active" href="/app/director">Diretor</a><a href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a href="/app/planos">Planos</a></nav>
        <div className="workspace-balance"><small>Saldo</small><strong>{dashboard.usage.creditsRemaining}</strong><span>créditos</span></div>
      </header>

      <main className="director-main">
        <section className="director-hero">
          <div><div className="section-kicker">MODO DIRECTOR</div><h1>Criatividade, direção e repertório para quem não sabe por onde começar.</h1><p>A MODO conhece a realidade da empresa, sugere o próximo movimento, cria o que pode ser produzido digitalmente e dirige o que precisa ser gravado, mostrado ou contado.</p></div>
          <div className="director-brand-select"><label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button-primary" disabled={!brandId || generating} onClick={() => void handleGenerate()}>{generating ? "Pensando o próximo ciclo..." : "Gerar plano criativo"}</button></div>
        </section>

        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        {dashboard.brands.length === 0 ? (
          <section className="director-empty"><h2>Cadastre uma marca para ativar o Diretor.</h2><a className="button button-primary" href="/app#brands">Cadastrar marca</a></section>
        ) : profile && (
          <>
            <section className="director-memory">
              <div className="director-section-head"><div><small>MODO MEMORY</small><h2>Quanto mais a MODO conhece, menos o cliente precisa explicar.</h2><p>Atualize quando algo mudar. Aprovações, revisões e desempenho continuarão alimentando esta memória automaticamente.</p></div><button className="button button-primary" disabled={saving} onClick={() => void handleSaveProfile()}>{saving ? "Salvando..." : "Salvar memória"}</button></div>

              <div className="director-memory-grid">
                <label>Pessoas que podem aparecer<textarea value={text(profile.peopleAvailable)} onChange={(event) => patchProfile({ peopleAvailable: lines(event.target.value) })} placeholder="Uma pessoa por linha: fundador, especialista, cliente, equipe..." /></label>
                <label>Locais e bastidores disponíveis<textarea value={text(profile.locations)} onChange={(event) => patchProfile({ locations: lines(event.target.value) })} placeholder="Escritório, loja, fábrica, consultório, evento..." /></label>
                <label>Produtos ou serviços para mostrar<textarea value={text(profile.productsOrServicesToShow)} onChange={(event) => patchProfile({ productsOrServicesToShow: lines(event.target.value) })} placeholder="Um por linha" /></label>
                <label>Provas, resultados e histórias<textarea value={text(profile.proofAvailable)} onChange={(event) => patchProfile({ proofAvailable: lines(event.target.value) })} placeholder="Cases, números, depoimentos, transformações..." /></label>
                <label>Dúvidas e objeções frequentes<textarea value={text(profile.recurringQuestions)} onChange={(event) => patchProfile({ recurringQuestions: lines(event.target.value) })} placeholder="O que os clientes sempre perguntam?" /></label>
                <label>Prioridades comerciais atuais<textarea value={text(profile.currentPriorities)} onChange={(event) => patchProfile({ currentPriorities: lines(event.target.value) })} placeholder="Produto, lançamento, agenda, posicionamento..." /></label>
              </div>

              <div className="director-preferences">
                <label className="director-camera"><input type="checkbox" checked={profile.comfortableOnCamera} onChange={(event) => patchProfile({ comfortableOnCamera: event.target.checked })} /><span><strong>Tem alguém confortável em aparecer?</strong><small>A MODO ajusta a quantidade e a dificuldade das missões de vídeo.</small></span></label>
                <label>Tempo disponível por semana<input type="number" min="0" max="600" value={profile.weeklyMinutesAvailable} onChange={(event) => patchProfile({ weeklyMinutesAvailable: Number(event.target.value) })} /><span>minutos</span></label>
              </div>

              <fieldset className="director-channels"><legend>Canais prioritários</legend><div>{allChannels.map((channel) => { const active = profile.preferredChannels.includes(channel); return <button type="button" className={active ? "active" : ""} key={channel} onClick={() => patchProfile({ preferredChannels: active ? profile.preferredChannels.filter((item) => item !== channel) : [...profile.preferredChannels, channel] })}>{channelLabels[channel]}</button>; })}</div></fieldset>

              <label className="director-notes">Contexto adicional e restrições<textarea value={profile.notes} onChange={(event) => patchProfile({ notes: event.target.value })} placeholder="Ex.: evitar promessas financeiras, não usar tom agressivo, priorizar atendimento humanizado..." /></label>
            </section>

            <section className="director-plan">
              <div className="director-section-head"><div><small>PRÓXIMOS MOVIMENTOS</small><h2>Plano criativo para {brand?.name}</h2><p>Escolha uma direção, leve para produção ou envie a missão para quem vai participar.</p></div><span>{recommendations.filter((item) => item.status === "suggested").length} sugestões ativas</span></div>

              {recommendations.length === 0 ? (
                <div className="director-empty"><h3>A MODO ainda não montou este ciclo.</h3><p>Salve a memória e clique em “Gerar plano criativo”.</p></div>
              ) : (
                <div className="director-recommendation-list">
                  {recommendations.map((item) => (
                    <article className={`director-recommendation ${item.kind} ${item.status}`} key={item.id}>
                      <div className="director-recommendation-top"><div><span>{kindLabels[item.kind]}</span><b>Prioridade {item.priorityScore}</b></div><small>{item.effortMinutes} min de esforço</small></div>
                      <h3>{item.title}</h3>
                      <p className="director-rationale">{item.rationale}</p>
                      <div className="director-outcome"><small>RESULTADO ESPERADO</small><strong>{item.expectedOutcome}</strong></div>
                      <div className="director-channel-list">{item.channels.map((channel) => <span key={channel}>{channelLabels[channel]}</span>)}</div>

                      {item.captureMission && (
                        <div className="director-mission">
                          <div><small>MISSÃO DE CAPTURA</small><strong>{item.captureMission.person}</strong><span>{item.captureMission.duration} · {item.captureMission.estimatedMinutes} min</span></div>
                          <blockquote>“{item.captureMission.openingLine}”</blockquote>
                          <ol>{item.captureMission.structure.map((step) => <li key={step}>{step}</li>)}</ol>
                          <div className="director-mission-meta"><p><b>Local:</b> {item.captureMission.location}</p><p><b>Enquadramento:</b> {item.captureMission.framing}</p></div>
                        </div>
                      )}

                      <div className="director-derivatives"><small>PODE VIRAR</small>{item.derivativeAssets.map((asset) => <span key={asset}>{asset}</span>)}</div>

                      <div className="director-actions">
                        {item.captureMission && <button type="button" className="button button-outline" onClick={() => void copyMission(item)}>Copiar missão</button>}
                        <button type="button" className="button button-primary" disabled={actionId === item.id} onClick={() => void takeToProduction(item)}>{item.kind === "capture" ? "Criar roteiro e derivados" : "Levar para produção"}</button>
                        <button type="button" className="director-dismiss" disabled={actionId === item.id} onClick={() => void handleStatus(item, "dismissed")}>Agora não</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
