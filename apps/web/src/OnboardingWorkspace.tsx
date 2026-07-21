import { nicheLabels, type Dashboard, type Niche } from "@modo/contracts";
import type { CreativeChannel } from "@modo/contracts/creative-intelligence";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createBrand, getDashboard, getSessionToken } from "./api";
import { generateCreativePlan, saveCreativeProfile } from "./director-api";

const channelOptions: Array<{ id: CreativeChannel; name: string; copy: string; featured?: boolean }> = [
  { id: "linkedin", name: "LinkedIn", copy: "Autoridade profissional, marca empregadora, founders e geração de oportunidades B2B.", featured: true },
  { id: "instagram", name: "Instagram", copy: "Presença visual, relacionamento, prova e descoberta da marca." },
  { id: "reels", name: "Reels", copy: "Vídeos curtos com rosto, demonstração, história e alcance." },
  { id: "stories", name: "Stories", copy: "Bastidores, interação, proximidade e chamadas rápidas." },
  { id: "facebook", name: "Facebook", copy: "Comunidade, alcance local, campanhas e reaproveitamento." },
  { id: "tiktok", name: "TikTok", copy: "Descoberta, linguagem nativa e vídeos com ritmo rápido." },
  { id: "youtube_shorts", name: "YouTube Shorts", copy: "Vídeos curtos com vida útil maior e descoberta por busca." },
  { id: "whatsapp", name: "WhatsApp", copy: "Relacionamento, ofertas, conteúdo útil e ativação da base." },
  { id: "email", name: "E-mail", copy: "Nutrição, relacionamento e conversão com a base própria." },
];

const objectiveOptions = [
  { id: "authority", title: "Construir autoridade", copy: "Ser lembrado como referência no assunto." },
  { id: "leads", title: "Gerar oportunidades", copy: "Atrair conversas, contatos e pedidos de orçamento." },
  { id: "sales", title: "Vender melhor", copy: "Explicar valor, quebrar objeções e apresentar ofertas." },
  { id: "humanize", title: "Humanizar a marca", copy: "Mostrar pessoas, histórias, rotina e bastidores reais." },
  { id: "educate", title: "Educar o público", copy: "Ensinar, organizar dúvidas e preparar a decisão de compra." },
  { id: "recruit", title: "Atrair talentos", copy: "Fortalecer cultura, liderança e marca empregadora." },
];

function splitItems(value: string) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export default function OnboardingWorkspace() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [brandName, setBrandName] = useState("");
  const [brandWebsite, setBrandWebsite] = useState("");
  const [brandInstagram, setBrandInstagram] = useState("");
  const [brandNiche, setBrandNiche] = useState<Niche>("servicos_profissionais");
  const [brandId, setBrandId] = useState("");

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
    if (!getSessionToken()) {
      window.location.href = "/app";
      return;
    }
    getDashboard()
      .then((current) => {
        setDashboard(current);
        const firstBrand = current.brands[0];
        if (firstBrand) {
          setBrandId(firstBrand.id);
          setStep(1);
        } else {
          setStep(0);
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível iniciar o onboarding."))
      .finally(() => setLoading(false));
  }, []);

  const totalSteps = 5;
  const visibleStep = Math.max(1, step);
  const progress = Math.round((visibleStep / totalSteps) * 100);

  const selectedBrand = useMemo(
    () => dashboard?.brands.find((brand) => brand.id === brandId),
    [dashboard, brandId],
  );

  function toggleObjective(id: string) {
    setObjectives((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleChannel(id: CreativeChannel) {
    setChannels((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((item) => item !== id);
      if (current.length >= 6) return current;
      return [...current, id];
    });
  }

  async function handleCreateBrand(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const normalizedUrl = brandWebsite
        ? /^https?:\/\//i.test(brandWebsite) ? brandWebsite : `https://${brandWebsite}`
        : "";
      const brand = await createBrand({
        name: brandName,
        websiteUrl: normalizedUrl,
        instagramHandle: brandInstagram,
        niche: brandNiche,
      });
      const current = await getDashboard();
      setDashboard(current);
      setBrandId(brand.id);
      setStep(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar a marca.");
    } finally {
      setSaving(false);
    }
  }

  async function finishOnboarding() {
    if (!brandId) return;
    setSaving(true);
    setError("");
    try {
      const objectiveTitles = objectives
        .map((id) => objectiveOptions.find((item) => item.id === id)?.title)
        .filter((item): item is string => Boolean(item));

      await saveCreativeProfile({
        brandId,
        peopleAvailable: splitItems(people),
        comfortableOnCamera,
        weeklyMinutesAvailable: weeklyMinutes,
        locations: splitItems(locations),
        productsOrServicesToShow: splitItems(offers),
        proofAvailable: splitItems(proof),
        recurringQuestions: splitItems(questions),
        currentPriorities: objectiveTitles,
        prohibitedTopics: [],
        preferredChannels: channels,
        notes,
      });
      await generateCreativePlan(brandId);
      if (dashboard) {
        window.localStorage.setItem(`modo.onboardingCompleted:${dashboard.organization.id}`, "true");
      }
      window.location.href = "/app/director";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível concluir o onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !dashboard) {
    return <main className="portal-loading"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Preparando seus primeiros passos...</p>{error && <div className="portal-error">{error}</div>}</main>;
  }

  return (
    <div className="onboarding-shell">
      <header className="onboarding-topbar">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <div><span>Primeiros passos</span><a href="/app">Sair do onboarding</a></div>
      </header>

      <main className="onboarding-main">
        <aside className="onboarding-aside">
          <div className="section-kicker">MODO START</div>
          <h1>Vamos transformar sua empresa em uma presença que sabe o que fazer.</h1>
          <p>Você não precisa chegar com ideias, calendário ou prompts. A MODO conhece o contexto, propõe movimentos e organiza o próximo passo.</p>
          <div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div>
          <small>Etapa {visibleStep} de {totalSteps}</small>
          <div className="onboarding-promise">
            <strong>Ao terminar, você terá:</strong>
            <span>✓ memória inicial da marca</span>
            <span>✓ canais e objetivos definidos</span>
            <span>✓ primeiro plano criativo</span>
            <span>✓ recomendações para criar e gravar</span>
          </div>
        </aside>

        <section className="onboarding-card">
          {error && <div className="portal-error">{error}</div>}

          {step === 0 && (
            <form onSubmit={handleCreateBrand} className="onboarding-form">
              <div className="onboarding-heading"><small>ANTES DE COMEÇAR</small><h2>Qual empresa ou marca a MODO vai acompanhar?</h2><p>Esse será o primeiro contexto usado para planejar, criar e aprender.</p></div>
              <label>Nome da marca ou empresa<input value={brandName} onChange={(event) => setBrandName(event.target.value)} required /></label>
              <label>Site <span>(opcional)</span><input value={brandWebsite} onChange={(event) => setBrandWebsite(event.target.value)} placeholder="www.suaempresa.com.br" /></label>
              <label>Instagram <span>(opcional)</span><input value={brandInstagram} onChange={(event) => setBrandInstagram(event.target.value)} placeholder="@suaempresa" /></label>
              <label>Segmento<select value={brandNiche} onChange={(event) => setBrandNiche(event.target.value as Niche)}>{(Object.keys(nicheLabels) as Niche[]).map((niche) => <option key={niche} value={niche}>{nicheLabels[niche]}</option>)}</select></label>
              <button className="button button-primary button-full" disabled={saving}>{saving ? "Salvando..." : "Continuar"}</button>
            </form>
          )}

          {step === 1 && (
            <div>
              <div className="onboarding-heading"><small>O POTENCIAL DA MODO</small><h2>Não é apenas uma ferramenta que escreve posts.</h2><p>A MODO funciona como uma diretoria de presença digital acessível para quem não sabe por onde começar.</p></div>
              <div className="onboarding-capabilities">
                <article><span>01</span><strong>Entende</strong><p>Organiza oferta, público, voz, provas, dúvidas e prioridades.</p></article>
                <article><span>02</span><strong>Planeja</strong><p>Propõe campanhas, calendário e próximos movimentos.</p></article>
                <article><span>03</span><strong>Cria</strong><p>Produz posts, carrosséis, roteiros, stories e documentos.</p></article>
                <article><span>04</span><strong>Dirige</strong><p>Orienta vídeos com rosto, histórias, bastidores e demonstrações.</p></article>
                <article><span>05</span><strong>Distribui</strong><p>Adapta para Instagram, Facebook, LinkedIn e outros canais.</p></article>
                <article><span>06</span><strong>Aprende</strong><p>Usa aprovações, revisões e desempenho para melhorar o próximo ciclo.</p></article>
              </div>
              <div className="onboarding-linkedin-callout"><div className="linkedin-mark">in</div><div><strong>LinkedIn faz parte da operação.</strong><p>A MODO cria conteúdo de autoridade para profissionais, founders e empresas, prepara documentos em PDF e organiza publicação e aprendizado por desempenho.</p></div></div>
              <button className="button button-primary button-full" onClick={() => setStep(2)}>Entendi. Vamos definir meu objetivo</button>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="onboarding-heading"><small>OBJETIVO</small><h2>O que a presença precisa gerar primeiro?</h2><p>Escolha uma ou mais prioridades. A MODO usará isso para decidir o que recomendar.</p></div>
              <div className="onboarding-choice-grid">{objectiveOptions.map((item) => <button type="button" className={objectives.includes(item.id) ? "selected" : ""} key={item.id} onClick={() => toggleObjective(item.id)}><strong>{item.title}</strong><span>{item.copy}</span></button>)}</div>
              <div className="onboarding-actions"><button className="button button-outline" onClick={() => setStep(1)}>Voltar</button><button className="button button-primary" disabled={!objectives.length} onClick={() => setStep(3)}>Escolher canais</button></div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="onboarding-heading"><small>CANAIS</small><h2>Onde sua marca precisa construir presença?</h2><p>O mesmo tema pode virar formatos diferentes. Escolha até seis canais prioritários.</p></div>
              <div className="onboarding-channel-grid">{channelOptions.map((item) => <button type="button" className={`${channels.includes(item.id) ? "selected" : ""} ${item.featured ? "featured" : ""}`} key={item.id} onClick={() => toggleChannel(item.id)}>{item.featured && <em>OPORTUNIDADE B2B</em>}<strong>{item.name}</strong><span>{item.copy}</span></button>)}</div>
              <div className="onboarding-actions"><button className="button button-outline" onClick={() => setStep(2)}>Voltar</button><button className="button button-primary" onClick={() => setStep(4)}>Como vamos produzir</button></div>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className="onboarding-heading"><small>REALIDADE DA EMPRESA</small><h2>A MODO precisa recomendar ações que caibam na sua rotina.</h2><p>Não existe obrigação de aparecer. A estratégia será adaptada aos recursos disponíveis.</p></div>
              <div className="onboarding-form two-columns">
                <label className="field-wide">Quem pode aparecer nos conteúdos? <span>(separar por vírgula)</span><input value={people} onChange={(event) => setPeople(event.target.value)} placeholder="Fundador, especialista, equipe comercial..." /></label>
                <label>Tempo disponível por semana<select value={weeklyMinutes} onChange={(event) => setWeeklyMinutes(Number(event.target.value))}><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={45}>45 minutos</option><option value={60}>1 hora</option><option value={120}>2 horas</option><option value={240}>4 horas</option></select></label>
                <label className="camera-choice"><span>Alguém se sente confortável em vídeo?</span><div><button type="button" className={comfortableOnCamera ? "selected" : ""} onClick={() => setComfortableOnCamera(true)}>Sim</button><button type="button" className={!comfortableOnCamera ? "selected" : ""} onClick={() => setComfortableOnCamera(false)}>Ainda não</button></div></label>
                <label className="field-wide">Locais e bastidores disponíveis<input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Escritório, loja, obra, consultório, home office..." /></label>
              </div>
              <div className="onboarding-actions"><button className="button button-outline" onClick={() => setStep(3)}>Voltar</button><button className="button button-primary" onClick={() => setStep(5)}>Última etapa</button></div>
            </div>
          )}

          {step === 5 && (
            <div>
              <div className="onboarding-heading"><small>MATÉRIA-PRIMA CRIATIVA</small><h2>O que a MODO já pode usar para gerar ideias melhores?</h2><p>Não precisa preencher tudo. Quanto mais contexto real, menos genérico será o plano.</p></div>
              <div className="onboarding-form">
                <label>Produtos ou serviços principais<textarea value={offers} onChange={(event) => setOffers(event.target.value)} placeholder="Um por linha ou separados por vírgula" /></label>
                <label>Cases, resultados, histórias ou provas<textarea value={proof} onChange={(event) => setProof(event.target.value)} placeholder="Ex.: reduzimos o prazo em 40%; atendemos 500 clientes; história do fundador..." /></label>
                <label>Dúvidas e objeções que os clientes sempre trazem<textarea value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder="Ex.: quanto custa? funciona para empresa pequena? por que contratar agora?" /></label>
                <label>Algo que a MODO precisa respeitar<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Restrições, linguagem, temas sensíveis ou observações." /></label>
              </div>
              <div className="onboarding-summary"><strong>Pronto para gerar o primeiro plano de {selectedBrand?.name || "sua marca"}.</strong><p>A MODO salvará esta memória e criará recomendações para os canais selecionados, incluindo ações que ela produz e missões que sua equipe pode executar.</p></div>
              <div className="onboarding-actions"><button className="button button-outline" onClick={() => setStep(4)}>Voltar</button><button className="button button-primary" disabled={saving} onClick={() => void finishOnboarding()}>{saving ? "Criando seu plano..." : "Gerar meu primeiro plano"}</button></div>
            </div>
          )}
        </section>
      </main>

      <footer className="onboarding-legal">MODO é uma solução da Alternative Ventures — CNPJ 61.920.356/0001-38.</footer>
    </div>
  );
}
