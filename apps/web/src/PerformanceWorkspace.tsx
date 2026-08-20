import type { Dashboard } from "@modo/contracts";
import type { NativeAnalyticsSummary, NativeCalendarItem } from "@modo/contracts/native-publisher";
import { useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import {
  getNativeBrandInsights,
  getNativeCalendar,
  refreshNativeAnalytics,
} from "./native-publisher-api";
import "./performance.css";

const platformLabels: Record<NativeCalendarItem["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
};

function range() {
  const from = new Date();
  from.setDate(from.getDate() - 60);
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function signalCopy(signal: string, samples: number) {
  if (samples === 0) return "Publique as primeiras peças. A MODO começa a aprender assim que as redes devolvem dados.";
  if (signal === "strong") return "Os conteúdos recentes estão gerando um sinal forte. O Diretor dará mais peso aos padrões vencedores.";
  if (signal === "weak") return "Os resultados recentes pedem mudança de ângulo, formato ou oferta. A MODO já registrou esse sinal.";
  if (signal === "learning") return "Há dados suficientes para aprender, mas ainda não existe um padrão dominante. Continue testando com consistência.";
  return "Ainda são poucas leituras para alterar a estratégia com segurança. Continue distribuindo e medindo.";
}

export default function PerformanceWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [brandId, setBrandId] = useState("");
  const [items, setItems] = useState<NativeCalendarItem[]>([]);
  const [insights, setInsights] = useState<{ samples: number; averageScore: number; bestScore: number; signal: string } | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, NativeAnalyticsSummary>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextBrandId?: string) {
    const currentDashboard = dashboard || await getDashboard();
    if (!dashboard) setDashboard(currentDashboard);
    const selected = nextBrandId || brandId || currentDashboard.brands[0]?.id || "";
    setBrandId(selected);
    if (!selected) return;
    const period = range();
    const [calendar, summary] = await Promise.all([
      getNativeCalendar({ brandId: selected, ...period }),
      getNativeBrandInsights(selected),
    ]);
    setItems(calendar.items.filter((item) => item.status === "published").sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor)));
    setInsights(summary);
  }

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    load()
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar os resultados."))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const byPlatform: Partial<Record<NativeCalendarItem["platform"], number>> = {};
    for (const item of items) byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    return byPlatform;
  }, [items]);

  async function changeBrand(nextBrandId: string) {
    setLoading(true);
    setError("");
    try {
      await load(nextBrandId);
      setAnalytics({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível trocar a marca.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh(item: NativeCalendarItem) {
    setBusy(item.id);
    try {
      const summary = await refreshNativeAnalytics(item.id);
      setAnalytics((current) => ({ ...current, [item.id]: summary }));
      setInsights(await getNativeBrandInsights(item.brandId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o desempenho.");
    } finally {
      setBusy("");
    }
  }

  if (loading && !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Lendo o que funcionou...</p></main>;
  }
  if (!dashboard) return null;

  return (
    <div className="performance-shell">
      <header className="workspace-header">
        <a href="/app"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/app">Painel</a><a href="/app/week">Minha semana</a><a href="/app/director">Diretor</a><a className="active" href="/app/resultados">Resultados</a><a href="/app/settings/integrations">Integrações</a></nav>
        <div className="workspace-balance"><small>Publicados</small><strong>{items.length}</strong><span>últimos 60 dias</span></div>
      </header>

      <main className="performance-main">
        <section className="performance-hero">
          <div><div className="section-kicker">MODO LEARNING</div><h1>Métrica só importa quando muda a próxima decisão.</h1><p>A MODO lê desempenho, transforma sinais em aprendizado e devolve ao Diretor o que merece ser repetido ou abandonado.</p></div>
          <label>Marca<select value={brandId} onChange={(event) => void changeBrand(event.target.value)}>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        </section>

        {error && <div className="portal-error">{error}</div>}

        <section className="performance-summary">
          <article className="primary"><small>LEITURAS REAIS</small><strong>{insights?.samples || 0}</strong><span>publicações com analytics</span></article>
          <article><small>SCORE MÉDIO</small><strong>{insights?.averageScore || 0}</strong><span>de 100</span></article>
          <article><small>MELHOR SINAL</small><strong>{insights?.bestScore || 0}</strong><span>de 100</span></article>
          <article><small>PUBLICADOS</small><strong>{items.length}</strong><span>janela de 60 dias</span></article>
        </section>

        <section className={`performance-decision ${insights?.signal || "insufficient_data"}`}>
          <div><small>O QUE A MODO ESTÁ APRENDENDO</small><h2>{insights?.signal === "strong" ? "Repita com inteligência." : insights?.signal === "weak" ? "Mude a direção." : "Continue testando."}</h2></div>
          <p>{signalCopy(insights?.signal || "insufficient_data", insights?.samples || 0)}</p>
        </section>

        <section className="performance-platforms">
          {(Object.keys(platformLabels) as NativeCalendarItem["platform"][]).map((platform) => <article key={platform}><span>{platformLabels[platform]}</span><strong>{counts[platform] || 0}</strong><small>publicação{(counts[platform] || 0) === 1 ? "" : "ões"}</small></article>)}
        </section>

        <section className="performance-feed">
          <div className="performance-feed-heading"><div><small>CONTEÚDOS PUBLICADOS</small><h2>Leia o resultado no contexto.</h2></div><a className="button button-outline" href="/app/week">Ver calendário</a></div>
          {items.length === 0 ? <div className="performance-empty"><strong>Ainda não há publicação nesta janela.</strong><p>Aprove uma peça e use o MODO Publisher para começar o ciclo de aprendizado.</p><a href="/app/content">Criar conteúdo</a></div> : items.map((item) => {
            const result = analytics[item.id];
            return <article key={item.id} className="performance-item"><div className="performance-item-head"><div><span>{platformLabels[item.platform]}</span><h3>{item.contentTitle}</h3><small>{new Date(item.publishedAt || item.scheduledFor).toLocaleString("pt-BR")}</small></div><div>{item.releaseUrl && <a href={item.releaseUrl} target="_blank" rel="noreferrer">Ver post ↗</a>}<button disabled={busy === item.id} onClick={() => void refresh(item)}>{busy === item.id ? "Lendo..." : result ? "Atualizar novamente" : "Ler desempenho"}</button></div></div>{result && <div className="performance-metrics"><div className="performance-score"><strong>{result.score}</strong><span>score</span></div>{result.metrics.filter((metric) => metric.value > 0).slice(0, 7).map((metric) => <span key={metric.key}><b>{metric.value.toLocaleString("pt-BR")}</b>{metric.label}</span>)}{result.engagementRate !== null && <span><b>{result.engagementRate.toFixed(2)}%</b>engajamento ponderado</span>}<p>{result.learningSignal === "performed_well" ? "Padrão vencedor registrado no MODO Learning." : result.learningSignal === "performed_poorly" ? "Sinal fraco registrado; o Diretor reduzirá o peso deste padrão." : "Sinal neutro: a MODO guarda o dado sem forçar uma conclusão."}</p></div>}</article>;
          })}
        </section>
      </main>
    </div>
  );
}
