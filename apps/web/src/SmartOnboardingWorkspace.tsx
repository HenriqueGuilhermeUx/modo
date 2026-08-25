import { nicheLabels, type Dashboard, type Niche } from "@modo/contracts";
import type { BrandScanResult } from "@modo/contracts/brand-scan";
import type { CreativeChannel } from "@modo/contracts/creative-intelligence";
import type { BrandFoundation } from "@modo/contracts/strategy-network";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createBrand, getDashboard, getSessionToken } from "./api";
import { trackActivationEvent } from "./activation-api";
import { scanBrandUrl } from "./brand-scan-api";
import { generateCreativePlan, saveCreativeProfile } from "./director-api";
import { saveBrandFoundation } from "./strategy-network-api";

const channelOptions: Array<{ id: CreativeChannel; name: string }> = [
  { id: "linkedin", name: "LinkedIn" }, { id: "instagram", name: "Instagram" },
  { id: "reels", name: "Reels" }, { id: "stories", name: "Stories" },
  { id: "facebook", name: "Facebook" }, { id: "tiktok", name: "TikTok" },
  { id: "youtube_shorts", name: "YouTube Shorts" }, { id: "whatsapp", name: "WhatsApp" },
  { id: "email", name: "E-mail" },
];

const objectiveOptions = [
  ["authority", "Construir autoridade"], ["leads", "Gerar oportunidades"],
  ["sales", "Vender melhor"], ["humanize", "Humanizar a marca"],
  ["educate", "Educar o público"], ["recruit", "Atrair talentos"],
] as const;

function splitItems(value: string) {
  return value.split(/\n|,/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

function objectivesFromScan(priorities: string[]) {
  const text = priorities.join(" ").toLowerCase();
  const values = new Set<string>();
  if (/lead|oportun|demanda|contato|orçamento/.test(text)) values.add("leads");
  if (/vend|convers|oferta|receita/.test(text)) values.add("sales");
  if (/autoridade|referência|posicion/.test(text)) values.add("authority");
  if (/educ|ensinar|dúvida/.test(text)) values.add("educate");
  if (/human|bastidor|pessoa|história/.test(text)) values.add("humanize");
  return values.size ? [...values] : ["authority"];
}

export default function SmartOnboardingWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [error, setError] = useState("");
  const [scanUrl, setScanUrl] = useState("");
  const [scanResult, setScanResult] = useState<BrandScanResult | null>(null);
  const [foundation, setFoundation] = useState<BrandFoundation | null>(null);
  const [brandId, setBrandId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brandWebsite, setBrandWebsite] = useState("");
  const [brandInstagram, setBrandInstagram] = useState("");
  const [brandNiche, setBrandNiche] = useState<Niche>("servicos_profissionais");
  const [objectives, setObjectives] = useState<string[]>(["authority"]);
  const [channels, setChannels] = useState<CreativeChannel[]>(["linkedin", "instagram"]);
  const [people, setPeople] = useState("");
  const [comfortableOnCamera, setComfortableOnCamera] = useState(false);
  const [weeklyMinutes, setWeeklyMinutes] = useState(45);
  const [locations, setLocations] = useState("");
  const [offers, setOffers] = useState("");
  const [proof, setProof] = useState("");
  const [questions, setQuestions] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!getSessionToken()) { window.location.href = "/app"; return; }
    void trackActivationEvent("onboarding_started").catch(() => undefined);
    getDashboard().then((current) => {
      setDashboard(current);
      const brand = current.brands[0];
      if (brand) {
        setBrandId(brand.id); setBrandName(brand.name); setBrandWebsite(brand.websiteUrl);
        setBrandInstagram(brand.instagramHandle); setBrandNiche(brand.niche); setStep(2);
      }
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível iniciar o onboarding."))
      .finally(() => setLoading(false));
  }, []);

  const progressStep = step + 1;
  const progress = Math.min(100, Math.round((progressStep / 4) * 100));
  const selectedBrand = useMemo(() => dashboard?.brands.find((brand) => brand.id === brandId), [dashboard, brandId]);

  function toggleObjective(id: string) {
    setObjectives((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function toggleChannel(id: CreativeChannel) {
    setChannels((current) => current.includes(id)
      ? current.length === 1 ? current : current.filter((item) => item !== id)
      : current.length >= 6 ? current : [...current, id]);
  }

  async function handleScan(event: FormEvent) {
    event.preventDefault();
    if (!scanUrl.trim()) return;
    setScanning(true); setError("");
    try {
      const result = await scanBrandUrl(scanUrl);
      setScanResult(result); setFoundation(result.foundation); setBrandName(result.brand.name);
      setBrandWebsite(result.brand.websiteUrl); setBrandInstagram(result.brand.instagramHandle); setBrandNiche(result.brand.niche);
      setOffers(result.suggestedProfile.productsOrServicesToShow.join("\n"));
      setProof(result.suggestedProfile.proofAvailable.join("\n"));
      setQuestions(result.suggestedProfile.recurringQuestions.join("\n"));
      setNotes(result.suggestedProfile.prohibitedTopics.length ? `Validar antes de usar:\n${result.suggestedProfile.prohibitedTopics.join("\n")}` : "");
      const suggestedChannels = result.suggestedProfile.preferredChannels.filter((id) => channelOptions.some((option) => option.id === id)).slice(0, 6);
      if (suggestedChannels.length) setChannels(suggestedChannels);
      setObjectives(objectivesFromScan(result.suggestedProfile.suggestedPriorities));
      setStep(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível analisar este link.");
    } finally { setScanning(false); }
  }

  async function saveBrand() {
    setSaving(true); setError("");
    try {
      const brand = await createBrand({ name: brandName, websiteUrl: brandWebsite, instagramHandle: brandInstagram, niche: brandNiche });
      if (foundation) await saveBrandFoundation({ brandId: brand.id, foundation, status: "draft" });
      const current = await getDashboard(); setDashboard(current); setBrandId(brand.id); setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a marca.");
    } finally { setSaving(false); }
  }

  async function handleManualBrand(event: FormEvent) { event.preventDefault(); await saveBrand(); }

  async function finishOnboarding() {
    if (!brandId) return;
    setSaving(true); setError("");
    try {
      const peopleAvailable = splitItems(people);
      if (foundation) {
        await saveBrandFoundation({
          brandId,
          foundation: { ...foundation, humanPresence: { ...foundation.humanPresence,
            spokespersons: peopleAvailable.length ? peopleAvailable : foundation.humanPresence.spokespersons,
            cameraAvailability: peopleAvailable.length ? comfortableOnCamera ? "high" : "low" : "none",
            notes: notes || foundation.humanPresence.notes,
          } },
          status: "draft",
        });
      }
      const objectiveTitles = objectives.map((id) => objectiveOptions.find(([key]) => key === id)?.[1]).filter((item): item is string => Boolean(item));
      await saveCreativeProfile({
        brandId, peopleAvailable, comfortableOnCamera, weeklyMinutesAvailable: weeklyMinutes,
        locations: splitItems(locations), productsOrServicesToShow: splitItems(offers), proofAvailable: splitItems(proof),
        recurringQuestions: splitItems(questions),
        currentPriorities: [...objectiveTitles, ...(scanResult?.suggestedProfile.suggestedPriorities || [])].slice(0, 15),
        prohibitedTopics: scanResult?.suggestedProfile.prohibitedTopics || [], preferredChannels: channels, notes,
      });
      await generateCreativePlan(brandId);
      await trackActivationEvent("onboarding_completed", { brandId, source: scanResult?.sourceType || "manual", objectives: objectives.length, channels: channels.length, weeklyMinutes }).catch(() => undefined);
      if (dashboard) window.localStorage.setItem(`modo.onboardingCompleted:${dashboard.organization.id}`, "true");
      window.location.href = "/app/director";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir o onboarding.");
    } finally { setSaving(false); }
  }

  if (loading || !dashboard) return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando seus primeiros passos...</p>{error && <div className="portal-error">{error}</div>}</main>;

  return <div className="onboarding-shell">
    <header className="onboarding-topbar"><a href="/"><img src="/logo.svg" alt="MODO" /></a><div><span>Primeiros passos</span><a href="/app">Sair do onboarding</a></div></header>
    <main className="onboarding-main">
      <aside className="onboarding-aside">
        <div className="section-kicker">MODO START</div><h1>Deixe a MODO conhecer sua empresa primeiro.</h1>
        <p>Comece pelo site ou Instagram. A MODO monta uma hipótese estratégica e pergunta apenas o que não pode descobrir sozinha.</p>
        <div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div><small>Etapa {progressStep} de 4</small>
        <div className="onboarding-promise"><strong>Ao terminar, você terá:</strong><span>✓ Base Estratégica inicial</span><span>✓ canais e objetivos confirmados</span><span>✓ memória operacional</span><span>✓ primeiro plano criativo</span></div>
      </aside>
      <section className="onboarding-card">
        {error && <div className="portal-error">{error}</div>}

        {step === 0 && !manualMode && <form onSubmit={handleScan} className="onboarding-scan">
          <div className="onboarding-heading"><small>SUA FONTE REAL</small><h2>Cole o site ou Instagram da empresa.</h2><p>A MODO lê o contexto público e mostra tudo para você confirmar antes de salvar.</p></div>
          <div className="scan-input-row"><input value={scanUrl} onChange={(event) => setScanUrl(event.target.value)} placeholder="suaempresa.com.br ou instagram.com/suaempresa" autoFocus /><button className="button button-primary" disabled={scanning || !scanUrl.trim()}>{scanning ? "Conhecendo..." : "Conhecer minha empresa ↗"}</button></div>
          {scanning && <div className="scan-progress-card"><div className="portal-spinner" /><div><strong>A MODO está lendo sua presença pública.</strong><span>Nada será salvo sem sua confirmação.</span></div></div>}
          <div className="scan-trust-row"><span>✓ site protegido</span><span>✓ Instagram público via Apify</span><span>✓ confirmação humana</span></div>
          <button type="button" className="onboarding-manual-link" onClick={() => { setManualMode(true); setError(""); }}>Não tenho um link agora — preencher manualmente</button>
        </form>}

        {step === 0 && manualMode && <form onSubmit={handleManualBrand} className="onboarding-form">
          <div className="onboarding-heading"><small>CADASTRO MANUAL</small><h2>Sem problema. Começamos pelo essencial.</h2></div>
          <label>Nome<input value={brandName} onChange={(e) => setBrandName(e.target.value)} required /></label>
          <label>Site <span>(opcional)</span><input value={brandWebsite} onChange={(e) => setBrandWebsite(e.target.value)} placeholder="https://..." /></label>
          <label>Instagram <span>(opcional)</span><input value={brandInstagram} onChange={(e) => setBrandInstagram(e.target.value)} placeholder="@suaempresa" /></label>
          <label>Segmento<select value={brandNiche} onChange={(e) => setBrandNiche(e.target.value as Niche)}>{(Object.keys(nicheLabels) as Niche[]).map((niche) => <option key={niche} value={niche}>{nicheLabels[niche]}</option>)}</select></label>
          <div className="onboarding-actions"><button type="button" className="button button-outline" onClick={() => setManualMode(false)}>Voltar ao scan</button><button className="button button-primary" disabled={saving}>{saving ? "Salvando..." : "Continuar"}</button></div>
        </form>}

        {step === 1 && scanResult && foundation && <div className="scan-confirmation">
          <div className="onboarding-heading"><small>PRIMEIRA LEITURA PRONTA</small><h2>Foi isso que entendemos. Você confirma.</h2><p>Edite qualquer hipótese antes de salvar.</p></div>
          <div className="scan-summary-strip"><div><small>CONFIANÇA</small><strong>{Math.round(scanResult.confidence * 100)}%</strong></div><div><small>FONTE</small><strong>{scanResult.sourceType === "instagram_apify" ? "Instagram" : "Site"}</strong></div><div><small>ITENS LIDOS</small><strong>{Math.max(1, scanResult.pagesAnalyzed.length)}</strong></div></div>
          <div className="onboarding-form two-columns scan-edit-grid">
            <label>Nome<input value={brandName} onChange={(e) => setBrandName(e.target.value)} /></label>
            <label>Segmento<select value={brandNiche} onChange={(e) => setBrandNiche(e.target.value as Niche)}>{(Object.keys(nicheLabels) as Niche[]).map((niche) => <option key={niche} value={niche}>{nicheLabels[niche]}</option>)}</select></label>
            <label className="field-wide">Público prioritário<textarea value={foundation.audience.priority} onChange={(e) => setFoundation({ ...foundation, audience: { ...foundation.audience, priority: e.target.value } })} /></label>
            <label>Diferencial<textarea value={foundation.positioning.differentiator} onChange={(e) => setFoundation({ ...foundation, positioning: { ...foundation.positioning, differentiator: e.target.value } })} /></label>
            <label>Benefício principal<textarea value={foundation.promise.mainBenefit} onChange={(e) => setFoundation({ ...foundation, promise: { ...foundation.promise, mainBenefit: e.target.value } })} /></label>
            <label>Tom de voz<textarea value={foundation.personality.tone} onChange={(e) => setFoundation({ ...foundation, personality: { ...foundation.personality, tone: e.target.value } })} /></label>
            <label>Produtos/serviços<textarea value={offers} onChange={(e) => setOffers(e.target.value)} /></label>
          </div>
          {scanResult.evidence.length > 0 && <div className="scan-evidence"><small>EVIDÊNCIAS</small><div>{scanResult.evidence.slice(0, 6).map((item, index) => <article key={`${item.field}-${index}`}><strong>{item.field}</strong><p>{item.evidence}</p></article>)}</div></div>}
          {scanResult.needsConfirmation.length > 0 && <div className="scan-needs-confirmation"><strong>A confirmar:</strong><span>{scanResult.needsConfirmation.slice(0, 6).join(" · ")}</span></div>}
          <div className="onboarding-actions"><button className="button button-outline" onClick={() => { setStep(0); setScanResult(null); setFoundation(null); }}>Usar outro link</button><button className="button button-primary" disabled={saving || !brandName.trim()} onClick={() => void saveBrand()}>{saving ? "Salvando..." : "Confirmar e criar minha Base"}</button></div>
        </div>}

        {step === 2 && <div>
          <div className="onboarding-heading"><small>O QUE SÓ VOCÊ SABE</small><h2>O que importa agora e o que cabe na rotina?</h2></div>
          <strong className="onboarding-mini-title">Objetivo atual</strong><div className="onboarding-choice-grid compact">{objectiveOptions.map(([id, title]) => <button type="button" className={objectives.includes(id) ? "selected" : ""} key={id} onClick={() => toggleObjective(id)}><strong>{title}</strong></button>)}</div>
          <strong className="onboarding-mini-title">Canais prioritários</strong><div className="onboarding-channel-grid compact">{channelOptions.map((item) => <button type="button" className={channels.includes(item.id) ? "selected" : ""} key={item.id} onClick={() => toggleChannel(item.id)}><strong>{item.name}</strong></button>)}</div>
          <div className="onboarding-form two-columns onboarding-reality"><label className="field-wide">Quem pode aparecer? <span>(opcional)</span><input value={people} onChange={(e) => setPeople(e.target.value)} /></label><label>Tempo por semana<select value={weeklyMinutes} onChange={(e) => setWeeklyMinutes(Number(e.target.value))}><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={45}>45 minutos</option><option value={60}>1 hora</option><option value={120}>2 horas</option></select></label><label className="camera-choice"><span>Confortável em vídeo?</span><div><button type="button" className={comfortableOnCamera ? "selected" : ""} onClick={() => setComfortableOnCamera(true)}>Sim</button><button type="button" className={!comfortableOnCamera ? "selected" : ""} onClick={() => setComfortableOnCamera(false)}>Ainda não</button></div></label><label className="field-wide">Locais/bastidores<input value={locations} onChange={(e) => setLocations(e.target.value)} /></label></div>
          <div className="onboarding-actions"><span /><button className="button button-primary" disabled={!objectives.length || !channels.length} onClick={() => setStep(3)}>Última confirmação</button></div>
        </div>}

        {step === 3 && <div>
          <div className="onboarding-heading"><small>MATÉRIA-PRIMA</small><h2>Confirme o que a MODO já pode usar.</h2><p>O que veio do scan já aparece preenchido.</p></div>
          <div className="onboarding-form"><label>Produtos ou serviços<textarea value={offers} onChange={(e) => setOffers(e.target.value)} /></label><label>Cases, resultados e provas<textarea value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Somente fatos reais." /></label><label>Dúvidas e objeções<textarea value={questions} onChange={(e) => setQuestions(e.target.value)} /></label><label>Restrições e observações<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
          <div className="onboarding-summary"><strong>Pronto para gerar o primeiro plano de {selectedBrand?.name || brandName || "sua marca"}.</strong><p>A Base continua editável e melhora com aprovações, revisões e performance.</p></div>
          <div className="onboarding-actions"><button className="button button-outline" onClick={() => setStep(2)}>Voltar</button><button className="button button-primary" disabled={saving} onClick={() => void finishOnboarding()}>{saving ? "Criando plano..." : "Gerar meu primeiro plano"}</button></div>
        </div>}
      </section>
    </main>
    <footer className="onboarding-legal">MODO · Alternative Ventures</footer>
  </div>;
}
