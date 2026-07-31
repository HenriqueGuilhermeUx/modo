import type { Dashboard } from "@modo/contracts";
import {
  intelligencePlaybookCatalog,
  type IntelligenceMission,
  type IntelligenceMissionCreate,
  type IntelligencePlaybook,
} from "@modo/contracts/intelligence";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { getDashboard, getSessionToken } from "./api";
import IntelligenceCommercialResults from "./IntelligenceCommercialResults";
import IntelligenceMissionAdvisor, {
  type IntelligenceNiche,
  type MissionAdvisorDraft,
} from "./IntelligenceMissionAdvisor";
import {
  createIntelligenceMission,
  getIntelligenceMission,
  getIntelligencePlaybooks,
  getIntelligenceResults,
  listIntelligenceMissions,
  retryIntelligenceMission,
  type IntelligenceQuota,
} from "./intelligence-api";

const statusLabels: Record<IntelligenceMission["status"], string> = {
  queued: "Na fila",
  running: "Coletando",
  succeeded: "Concluída",
  failed: "Revisar",
};

const providerLabels = {
  queue: "Fila interna",
  apify: "Apify direto",
  n8n: "n8n + Apify",
} as const;

const planLabels: Record<IntelligenceQuota["plan"], string> = {
  trial: "Teste",
  start: "Start",
  presenca: "Presença",
  pro: "Pro",
  business: "Business",
};

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function parseProducts(value: string) {
  return lines(value).map((line) => {
    const [name = "", sku = "", url = ""] = line.split("|").map((item) => item.trim());
    return { name, sku, url };
  }).filter((item) => item.name.length > 1);
}

export default function IntelligenceWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [missions, setMissions] = useState<IntelligenceMission[]>([]);
  const [provider, setProvider] = useState<"queue" | "apify" | "n8n">("queue");
  const [configured, setConfigured] = useState<Record<IntelligencePlaybook, boolean>>({
    market_radar: false,
    b2b_prospecting: false,
    price_monitoring: false,
  });
  const [quota, setQuota] = useState<IntelligenceQuota | null>(null);
  const [brandId, setBrandId] = useState("");
  const [playbook, setPlaybook] = useState<IntelligencePlaybook>("market_radar");
  const [name, setName] = useState("Radar inicial da marca");
  const [objective, setObjective] = useState("Encontrar oportunidades comerciais e movimentos relevantes do mercado.");
  const [regions, setRegions] = useState("");
  const [keywords, setKeywords] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [products, setProducts] = useState("");
  const [maxItems, setMaxItems] = useState(10);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [preview, setPreview] = useState<{
    mission: IntelligenceMission;
    items: Record<string, unknown>[];
  } | null>(null);

  useEffect(() => {
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    Promise.all([getDashboard(), getIntelligencePlaybooks(), listIntelligenceMissions()])
      .then(([nextDashboard, engine, nextMissions]) => {
        setDashboard(nextDashboard);
        setBrandId(nextDashboard.brands[0]?.id || "");
        setProvider(engine.provider);
        setConfigured(engine.configured);
        setQuota(engine.quota);
        setMaxItems(Math.max(1, Math.min(10, engine.quota.maxItemsPerRun, engine.quota.itemsRemaining || 10)));
        setMissions(nextMissions);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível abrir o motor de inteligência."))
      .finally(() => setLoading(false));
  }, []);

  const selectedPlaybook = useMemo(() => intelligencePlaybookCatalog[playbook], [playbook]);
  const selectedBrand = useMemo(
    () => dashboard?.brands.find((brand) => brand.id === brandId) || dashboard?.brands[0],
    [brandId, dashboard],
  );
  const quotaExhausted = Boolean(quota && (quota.runsRemaining < 1 || quota.itemsRemaining < 1));
  const missionLimit = quota
    ? Math.max(1, Math.min(quota.maxItemsPerRun, quota.itemsRemaining || quota.maxItemsPerRun))
    : 10;

  async function refreshEngine() {
    const engine = await getIntelligencePlaybooks();
    setProvider(engine.provider);
    setConfigured(engine.configured);
    setQuota(engine.quota);
    setMaxItems((current) => Math.max(1, Math.min(current, engine.quota.maxItemsPerRun, engine.quota.itemsRemaining || 1)));
  }

  function applyAdvisor(patch: Partial<MissionAdvisorDraft>) {
    if (patch.name !== undefined) setName(patch.name);
    if (patch.objective !== undefined) setObjective(patch.objective);
    if (patch.regions !== undefined) setRegions(patch.regions);
    if (patch.keywords !== undefined) setKeywords(patch.keywords);
    if (patch.competitors !== undefined) setCompetitors(patch.competitors);
    if (patch.products !== undefined) setProducts(patch.products);
    setSuccess("Estratégia aplicada. Complete apenas os dados reais que a Modo ainda não conhece.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const input: IntelligenceMissionCreate = {
        brandId,
        name,
        playbook,
        objective,
        regions: lines(regions),
        keywords: lines(keywords),
        competitors: lines(competitors),
        products: parseProducts(products),
        maxItems: Math.min(maxItems, missionLimit),
      };
      const mission = await createIntelligenceMission(input);
      setMissions((current) => [mission, ...current.filter((item) => item.id !== mission.id)]);
      await refreshEngine();
      setSuccess(
        provider === "queue"
          ? "Missão salva na fila interna. A coleta externa ainda não foi ativada."
          : "Missão iniciada e descontada da franquia de inteligência deste ciclo.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a missão.");
    } finally {
      setSaving(false);
    }
  }

  async function refresh(item: IntelligenceMission) {
    setBusy(item.id);
    setError("");
    try {
      const updated = await getIntelligenceMission(item.id);
      setMissions((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      await refreshEngine();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a missão.");
    } finally {
      setBusy("");
    }
  }

  async function retry(item: IntelligenceMission) {
    setBusy(item.id);
    setError("");
    setSuccess("");
    try {
      const updated = await retryIntelligenceMission(item.id);
      setMissions((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      await refreshEngine();
      setSuccess("Missão reenviada sem novo consumo. A tentativa original já havia sido contabilizada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível reenviar a missão.");
    } finally {
      setBusy("");
    }
  }

  async function showResults(item: IntelligenceMission) {
    setBusy(item.id);
    setError("");
    try {
      const result = await getIntelligenceResults(item.id, 100);
      setPreview(result);
      window.setTimeout(() => {
        document.querySelector(".commercial-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os resultados.");
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <main className="intelligence-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando o motor de inteligência...</p></main>;
  }

  if (!dashboard) {
    return <main className="intelligence-loading"><p>{error || "Sua sessão expirou."}</p><a className="button button-primary" href="/app">Entrar novamente</a></main>;
  }

  return (
    <div className="intelligence-shell">
      <header><a href="/app"><img src="/logo.svg" alt="MODO" /></a><div><small>MODO INTELLIGENCE</small><strong>Missões de mercado</strong></div><a href="/app">Voltar ao painel</a></header>
      <main>
        <section className="intelligence-hero">
          <div><span>OLHE PARA FORA DA MARCA</span><h1>Transforme perguntas de negócio em <strong>missões de inteligência.</strong></h1><p>Use esta área quando uma decisão depende de concorrentes, empresas, reputação, ofertas ou preços. A Modo organiza a pergunta e executa a pesquisa sem exigir conhecimento técnico.</p></div>
          <aside><small>PROVEDOR ATUAL</small><strong>{providerLabels[provider]}</strong><p>{provider === "queue" ? "Modo seguro: registra as missões sem consumir coleta externa." : "Execução externa habilitada com franquia e bloqueios de custo."}</p></aside>
        </section>

        <section className="intelligence-purpose">
          <article><small>RADAR DE MERCADO</small><strong>Entender concorrência e sinais</strong><p>Para observar reputação, ofertas, atividades e movimentos de um segmento.</p></article>
          <article><small>PROSPECÇÃO B2B</small><strong>Encontrar empresas compatíveis</strong><p>Para montar uma lista comercial focada por atividade e região.</p></article>
          <article><small>MONITORAMENTO DE PREÇOS</small><strong>Comparar produtos reais</strong><p>Para acompanhar preço, promoção, disponibilidade e frete em URLs informadas.</p></article>
        </section>

        {quota && <section className="intelligence-quota">
          <div><small>FRANQUIA DE INTELIGÊNCIA · PLANO {planLabels[quota.plan].toUpperCase()}</small><strong>{quota.runsRemaining} de {quota.monthlyRuns} pesquisas restantes</strong><span>Renova em {new Date(quota.periodEnd).toLocaleDateString("pt-BR")}</span></div>
          <div className="quota-stat"><small>REGISTROS</small><strong>{quota.itemsUsed}/{quota.monthlyItems}</strong><span>usados no ciclo</span></div>
          <div className="quota-stat"><small>POR MISSÃO</small><strong>até {quota.maxItemsPerRun}</strong><span>limite do plano</span></div>
          <div className="quota-progress"><span style={{ width: `${Math.min(100, quota.monthlyItems ? (quota.itemsUsed / quota.monthlyItems) * 100 : 0)}%` }} /></div>
        </section>}

        {error && <div className="portal-error portal-error-wide">{error}</div>}
        {success && <div className="workspace-success">{success}</div>}

        <section className="intelligence-layout">
          <form onSubmit={submit}>
            <div className="intelligence-form-title"><small>NOVA MISSÃO</small><h2>{selectedPlaybook.name}</h2><p>{selectedPlaybook.promise}</p></div>
            <div className="intelligence-fields two">
              <label>Marca<select value={brandId} onChange={(event) => setBrandId(event.target.value)} required>{dashboard.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
              <label>Playbook<select value={playbook} onChange={(event) => setPlaybook(event.target.value as IntelligencePlaybook)}><option value="market_radar">Radar de mercado</option><option value="b2b_prospecting">Prospecção B2B</option><option value="price_monitoring">Monitoramento de preços</option></select></label>
            </div>

            <IntelligenceMissionAdvisor
              playbook={playbook}
              niche={(selectedBrand?.niche || "outro") as IntelligenceNiche}
              brandName={selectedBrand?.name || "Sua marca"}
              name={name}
              objective={objective}
              regions={regions}
              keywords={keywords}
              competitors={competitors}
              products={products}
              onApply={applyAdvisor}
            />

            <div className="intelligence-fields two">
              <label>Nome da missão<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label>Limite desta missão <span>máximo do plano: {missionLimit}</span><input type="number" min={1} max={missionLimit} value={maxItems} onChange={(event) => setMaxItems(Math.max(1, Math.min(missionLimit, Number(event.target.value))))} /></label>
            </div>
            <div className="intelligence-fields">
              <label>Objetivo<textarea value={objective} onChange={(event) => setObjective(event.target.value)} required /></label>
              <label>Regiões <span>uma por linha; na prospecção use somente uma</span><textarea value={regions} onChange={(event) => setRegions(event.target.value)} placeholder={'Campinas, SP\nRegião Metropolitana de Campinas'} /></label>
              <label>Públicos, atividades, interesses ou palavras-chave <span>um por linha</span><textarea value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder={'restaurantes\nagenda ociosa\nreputação no Google'} /></label>
              <label>Concorrentes ou páginas de referência <span>nome, perfil ou URL real; um por linha</span><textarea value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder={'Nome do concorrente\nhttps://site-do-concorrente.com.br'} /></label>
              <label>Produtos <span>nome | SKU | URL direta, um por linha</span><textarea value={products} onChange={(event) => setProducts(event.target.value)} placeholder={'Produto X | SKU-123 | https://loja.com/produto-x\nProduto Y | SKU-456 | https://concorrente.com/produto-y'} /></label>
            </div>
            <div className="intelligence-form-footer"><div><small>STATUS DO PLAYBOOK</small><strong>{quotaExhausted ? "Franquia esgotada neste ciclo" : configured[playbook] ? "Task configurada" : provider === "queue" ? "Pronto para validação interna" : "Task ainda não configurada"}</strong></div><button className="button button-primary" disabled={saving || !brandId || quotaExhausted}>{saving ? "Criando missão..." : quotaExhausted ? "Limite atingido" : "Criar missão ↗"}</button></div>
          </form>

          <aside className="intelligence-missions">
            <div className="intelligence-list-title"><div><small>HISTÓRICO</small><h2>Missões recentes</h2></div><span>{missions.length}</span></div>
            <div className="intelligence-list">
              {missions.map((item) => (
                <article key={item.id}>
                  <div className="intelligence-card-head"><div><small>{intelligencePlaybookCatalog[item.playbook].name}</small><h3>{item.name}</h3></div><span className={`status-${item.status}`}>{statusLabels[item.status]}</span></div>
                  <p>{item.objective}</p>
                  <div className="intelligence-card-meta"><span>{item.resultCount} resultado(s)</span><span>{new Date(item.updatedAt).toLocaleString("pt-BR")}</span></div>
                  {item.providerMessage && <div className="intelligence-message">{item.providerMessage}</div>}
                  {item.status === "failed" && <div className="intelligence-retry-note"><strong>Esta tentativa já foi contabilizada.</strong> Você pode corrigir a integração e tentar novamente sem gastar outra pesquisa.</div>}
                  <footer><button type="button" disabled={busy === item.id} onClick={() => void refresh(item)}>Atualizar status</button>{item.status === "failed" && <button type="button" disabled={busy === item.id} onClick={() => void retry(item)}>Tentar novamente sem custo</button>}{item.status === "succeeded" && <button type="button" disabled={busy === item.id} onClick={() => void showResults(item)}>Abrir lista</button>}</footer>
                </article>
              ))}
              {!missions.length && <div className="intelligence-empty"><strong>Nenhuma missão criada.</strong><p>Comece com uma pergunta concreta de mercado e um limite pequeno.</p></div>}
            </div>
          </aside>
        </section>

        {preview && <IntelligenceCommercialResults mission={preview.mission} items={preview.items} onClose={() => setPreview(null)} />}
      </main>
      <style>{`.intelligence-shell{min-height:100vh;background:#f3f6fb;color:#0d1b3e}.intelligence-shell>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px max(20px,calc((100vw - 1380px)/2));background:#fff;border-bottom:1px solid #dfe6f1}.intelligence-shell header img{width:112px}.intelligence-shell header>div{display:grid;gap:3px}.intelligence-shell header small,.intelligence-form-title small,.intelligence-list-title small{font-size:9px;letter-spacing:.13em;font-weight:900;color:#1f5eff}.intelligence-shell header>a:last-child{font-size:12px;font-weight:800;color:#1f5eff}.intelligence-shell>main{width:min(1320px,calc(100% - 40px));margin:0 auto;padding:54px 0 80px}.intelligence-hero{display:grid;grid-template-columns:1.15fr .55fr;gap:35px;align-items:end;margin-bottom:20px}.intelligence-hero>div>span{font-size:10px;letter-spacing:.13em;font-weight:900;color:#1f5eff}.intelligence-hero h1{font:800 clamp(45px,5vw,68px)/1.02 Sora,sans-serif;letter-spacing:-.06em;margin:12px 0}.intelligence-hero h1 strong{color:#1f5eff}.intelligence-hero p{color:#5b657a;line-height:1.65;max-width:850px}.intelligence-hero aside{background:#0d1b3e;color:#fff;border-radius:22px;padding:24px}.intelligence-hero aside small{color:#2ed19a;font-size:9px;letter-spacing:.12em;font-weight:900}.intelligence-hero aside strong{font:800 22px Sora,sans-serif;display:block;margin:8px 0}.intelligence-hero aside p{color:#c2cce0;font-size:12px;margin:0}.intelligence-purpose{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}.intelligence-purpose article{background:#fff;border:1px solid #dfe6f1;border-radius:16px;padding:15px}.intelligence-purpose small{display:block;color:#1f5eff;font-size:8px;letter-spacing:.09em;font-weight:900}.intelligence-purpose strong{display:block;font:800 14px Sora,sans-serif;margin:7px 0}.intelligence-purpose p{color:#68748a;font-size:10px;line-height:1.5;margin:0}.intelligence-quota{display:grid;grid-template-columns:1.4fr .55fr .55fr;gap:10px;align-items:stretch;background:#fff;border:1px solid #dfe6f1;border-radius:19px;padding:14px;margin-bottom:18px;position:relative;overflow:hidden}.intelligence-quota>div{display:grid;align-content:center;gap:4px;padding:5px 10px}.intelligence-quota small{font-size:8px;letter-spacing:.1em;color:#1f5eff;font-weight:900}.intelligence-quota strong{font:800 18px Sora,sans-serif}.intelligence-quota span{font-size:10px;color:#68748a}.intelligence-quota .quota-stat{border-left:1px solid #e4e9f2}.intelligence-quota .quota-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:#eaf0ff;padding:0}.intelligence-quota .quota-progress span{height:100%;background:#1f5eff;display:block}.intelligence-layout{display:grid;grid-template-columns:1.05fr .95fr;gap:18px;align-items:start}.intelligence-layout>form,.intelligence-missions{background:#fff;border:1px solid #dfe6f1;border-radius:24px;padding:25px}.intelligence-form-title h2,.intelligence-list-title h2{font:800 28px Sora,sans-serif;margin:6px 0}.intelligence-form-title p{color:#5b657a;margin:0 0 20px}.intelligence-fields{display:grid;gap:13px;margin-top:13px}.intelligence-fields.two{grid-template-columns:1fr 1fr}.intelligence-fields label{display:grid;gap:7px;font-size:11px;font-weight:900}.intelligence-fields label span{font-weight:500;color:#7a8498}.intelligence-fields input,.intelligence-fields select,.intelligence-fields textarea{width:100%;border:1px solid #d8e1ef;border-radius:12px;padding:12px;background:#fbfcfe;color:#0d1b3e;font:500 13px Inter,sans-serif;box-sizing:border-box}.intelligence-fields textarea{min-height:84px;resize:vertical}.intelligence-form-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px;padding-top:18px;border-top:1px solid #e6ebf3}.intelligence-form-footer>div{display:grid;gap:4px}.intelligence-form-footer small{font-size:8px;color:#7a8498;font-weight:900}.intelligence-form-footer strong{font-size:12px}.intelligence-list-title{display:flex;justify-content:space-between;align-items:center}.intelligence-list-title>span{background:#eef3ff;color:#1f5eff;border-radius:999px;padding:9px 12px;font-weight:900}.intelligence-list{display:grid;gap:10px;margin-top:18px;max-height:720px;overflow:auto;padding-right:3px}.intelligence-list article{border:1px solid #e1e7f0;border-radius:17px;padding:16px}.intelligence-card-head{display:flex;justify-content:space-between;gap:15px}.intelligence-card-head small{font-size:8px;letter-spacing:.1em;color:#1f5eff;font-weight:900}.intelligence-card-head h3{font:800 17px Sora,sans-serif;margin:5px 0}.intelligence-card-head>span{height:max-content;border-radius:999px;padding:7px 9px;background:#fff3d8;color:#8a5b00;font-size:9px;font-weight:900}.intelligence-card-head>span.status-succeeded{background:#e9fbf4;color:#087655}.intelligence-card-head>span.status-failed{background:#fff0f0;color:#a52626}.intelligence-card-head>span.status-running{background:#eaf0ff;color:#1f5eff}.intelligence-list article>p{color:#5b657a;font-size:12px;line-height:1.5}.intelligence-card-meta{display:flex;justify-content:space-between;gap:12px;font-size:9px;color:#7a8498}.intelligence-message{background:#f4f7fb;border-radius:10px;padding:10px;margin-top:11px;color:#536078;font-size:11px;white-space:pre-wrap}.intelligence-retry-note{margin-top:9px;padding:9px 10px;border-radius:10px;background:#fff7e6;color:#765b24;font-size:9px;line-height:1.5}.intelligence-retry-note strong{display:block;color:#5a4214}.intelligence-list footer{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.intelligence-list button{border:0;border-radius:9px;padding:8px 10px;background:#0d1b3e;color:#fff;font-weight:800;font-size:10px;cursor:pointer}.intelligence-list button:first-child{background:#eaf0ff;color:#1f5eff}.intelligence-list button:disabled{opacity:.5;cursor:not-allowed}.intelligence-empty{border:1px dashed #cbd7e7;border-radius:16px;padding:30px;text-align:center}.intelligence-empty p{color:#5b657a;font-size:12px}.intelligence-loading{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:15px;background:#f3f6fb;color:#0d1b3e}.intelligence-loading img{width:130px}@media(max-width:980px){.intelligence-hero,.intelligence-layout{grid-template-columns:1fr}.intelligence-purpose{grid-template-columns:1fr}.intelligence-quota{grid-template-columns:1fr 1fr}.intelligence-quota>div:first-child{grid-column:1/-1}.intelligence-quota .quota-stat{border-left:0;border-top:1px solid #e4e9f2}}@media(max-width:640px){.intelligence-fields.two{grid-template-columns:1fr}.intelligence-form-footer{align-items:flex-start;flex-direction:column}.intelligence-form-footer .button{width:100%}.intelligence-shell>header>div{display:none}.intelligence-shell>main{width:min(100% - 24px,1320px)}.intelligence-hero h1{font-size:43px}.intelligence-quota{grid-template-columns:1fr}.intelligence-quota>div:first-child{grid-column:auto}}`}</style>
    </div>
  );
}
