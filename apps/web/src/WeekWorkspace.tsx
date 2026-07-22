import type { Dashboard } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import type { CreativeRecommendation } from "@modo/contracts/creative-intelligence";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken, listContentRequests } from "./api";
import {
  listCreativeRecommendations,
  recordCreativeFeedback,
  setCreativeRecommendationStatus,
} from "./director-api";

type WeekTask = {
  id: string;
  kind: "approve" | "capture" | "create" | "publish" | "wait" | "fix";
  title: string;
  copy: string;
  minutes: number;
  priority: number;
  href: string;
  request?: ContentRequest;
  recommendation?: CreativeRecommendation;
};

const kindLabels: Record<WeekTask["kind"], string> = {
  approve: "APROVAR",
  capture: "GRAVAR",
  create: "CRIAR",
  publish: "PUBLICAR E MEDIR",
  wait: "EM PRODUÇÃO",
  fix: "CORRIGIR",
};

function requestTitle(request: ContentRequest) {
  return request.output?.hook || request.brief.split("\n").find(Boolean) || "Conteúdo da marca";
}

export default function WeekWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [recommendations, setRecommendations] = useState<CreativeRecommendation[]>([]);
  const [brandId, setBrandId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const [currentDashboard, currentRequests] = await Promise.all([getDashboard(), listContentRequests()]);
    setDashboard(currentDashboard);
    setRequests(currentRequests);
    const nextBrandId = brandId || currentDashboard.brands[0]?.id || "";
    setBrandId(nextBrandId);
    if (nextBrandId) setRecommendations(await listCreativeRecommendations(nextBrandId));
  }

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível montar sua semana."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!brandId || !dashboard) return;
    listCreativeRecommendations(brandId).then(setRecommendations).catch(() => undefined);
  }, [brandId]);

  const tasks = useMemo<WeekTask[]>(() => {
    const result: WeekTask[] = [];
    for (const request of requests.filter((item) => item.brandId === brandId)) {
      if (request.status === "ready") result.push({ id: request.id, kind: "approve", title: `Revisar: ${requestTitle(request)}`, copy: "Leia a entrega, aprove ou escolha um ajuste guiado.", minutes: 4, priority: 100, href: `/app/content?open=${request.id}`, request });
      if (request.status === "failed") result.push({ id: request.id, kind: "fix", title: `Reenviar produção com falha`, copy: request.error || "A automação precisa ser reenviada.", minutes: 2, priority: 95, href: `/app/content?open=${request.id}`, request });
      if (["queued", "processing", "revision_requested"].includes(request.status)) result.push({ id: request.id, kind: "wait", title: `A MODO está produzindo: ${requestTitle(request)}`, copy: "Nenhuma ação necessária agora. O resultado aparecerá automaticamente.", minutes: 0, priority: 45, href: `/app/content?open=${request.id}`, request });
      if (request.status === "approved") result.push({ id: request.id, kind: "publish", title: `Publicar e acompanhar: ${requestTitle(request)}`, copy: "Use o Studio para exportar e depois ensine a MODO com o resultado.", minutes: 8, priority: 78, href: `/app/studio/${request.id}`, request });
    }

    for (const recommendation of recommendations.filter((item) => ["suggested", "accepted"].includes(item.status))) {
      const capture = recommendation.kind === "capture" && recommendation.captureMission;
      result.push({
        id: recommendation.id,
        kind: capture ? "capture" : "create",
        title: recommendation.title,
        copy: capture
          ? `${recommendation.captureMission?.person || "Pessoa indicada"} · ${recommendation.captureMission?.duration || "vídeo curto"} · ${recommendation.rationale}`
          : recommendation.rationale,
        minutes: recommendation.effortMinutes,
        priority: recommendation.priorityScore,
        href: "/app/director",
        recommendation,
      });
    }
    return result.sort((a, b) => b.priority - a.priority).slice(0, 12);
  }, [requests, recommendations, brandId]);

  const totalMinutes = tasks.reduce((total, task) => total + task.minutes, 0);
  const urgent = tasks.filter((task) => task.priority >= 80).length;

  async function markRecommendation(task: WeekTask) {
    if (!task.recommendation) return;
    setActionId(task.id);
    try {
      await setCreativeRecommendationStatus(task.id, "completed");
      setRecommendations((current) => current.map((item) => item.id === task.id ? { ...item, status: "completed" } : item));
      setSuccess("Missão concluída. A MODO guardou esse sinal.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir a missão.");
    } finally {
      setActionId("");
    }
  }

  async function quickSignal(request: ContentRequest, positive: boolean) {
    setActionId(request.id);
    try {
      await recordCreativeFeedback(request.brandId, {
        contentRequestId: request.id,
        signal: positive ? "performed_well" : "performed_poorly",
        score: positive ? 75 : 30,
        notes: positive
          ? "O cliente informou que este conteúdo gerou conversa, reação ou oportunidade."
          : "O cliente informou que este conteúdo ainda não apresentou resultado percebido.",
      });
      setSuccess(positive ? "Ótimo. Esse padrão ganhará peso nos próximos planos." : "Entendido. A MODO testará outro ângulo ou formato.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar o resultado.");
    } finally {
      setActionId("");
    }
  }

  function openSignal(request: ContentRequest) {
    window.sessionStorage.setItem("modo.signalPrefill", JSON.stringify({ brandId: request.brandId, contentRequestId: request.id }));
    window.location.href = "/app/signal";
  }

  if (loading || !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Organizando sua semana...</p></main>;

  return (
    <div className="week-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a className="active" href="/app/week">Minha semana</a><a href="/app/director">Diretor</a><a href="/app/content">Criar</a><a href="/app/linkedin">LinkedIn</a><a href="/app/signal">Signal</a></nav>
        <div className="workspace-balance"><small>Tempo estimado</small><strong>{totalMinutes}</strong><span>minutos</span></div>
      </header>

      <main className="week-main">
        <section className="week-hero">
          <div><div className="section-kicker">SUA SEMANA EM MODO PRESENÇA</div><h1>Menos decisões soltas. Próximos passos claros.</h1><p>A MODO reúne o que precisa ser aprovado, gravado, publicado e medido. Faça uma coisa por vez.</p></div>
          <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        </section>

        <section className="week-summary"><article><small>AÇÕES</small><strong>{tasks.length}</strong><span>organizadas</span></article><article><small>PRIORIDADE</small><strong>{urgent}</strong><span>pedem atenção</span></article><article><small>TEMPO</small><strong>{totalMinutes}</strong><span>minutos estimados</span></article><article><small>REGRA</small><strong>1</strong><span>próximo passo por vez</span></article></section>
        {error && <div className="portal-error">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className="week-list">
          {tasks.length === 0 ? <div className="week-empty"><strong>Sua semana está livre.</strong><p>Gere um plano no Diretor ou comece pelo Quick Start.</p><a className="button button-primary" href="/app/content">Começar conteúdo</a></div> : tasks.map((task, index) => <article className={`week-task ${task.kind}`} key={`${task.kind}-${task.id}`}><div className="week-task-order">{String(index + 1).padStart(2, "0")}</div><div className="week-task-content"><div><span>{kindLabels[task.kind]}</span><em>{task.minutes ? `${task.minutes} min` : "automático"}</em></div><h2>{task.title}</h2><p>{task.copy}</p>{task.kind === "publish" && task.request && <div className="week-signal-buttons"><button disabled={actionId === task.id} onClick={() => void quickSignal(task.request!, true)}>✓ Gerou conversa ou resultado</button><button disabled={actionId === task.id} onClick={() => void quickSignal(task.request!, false)}>Ainda não funcionou</button><button onClick={() => openSignal(task.request!)}>Informar métricas</button></div>}</div><div className="week-task-actions"><a className="button button-outline" href={task.href}>{task.kind === "capture" ? "Ver missão" : task.kind === "publish" ? "Abrir no Studio" : "Abrir"}</a>{task.recommendation && <button className="button button-primary" disabled={actionId === task.id} onClick={() => void markRecommendation(task)}>Marcar concluída</button>}</div></article>)}
        </section>
      </main>
    </div>
  );
}
