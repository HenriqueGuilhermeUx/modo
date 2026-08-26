import type { PartnerBusinessType } from "@modo/contracts/strategy-network";
import { type FormEvent, useMemo, useState } from "react";
import { createPartnerApplication } from "./partner-api";

const businessTypeLabels: Record<PartnerBusinessType, string> = {
  agency: "Agência de marketing/publicidade",
  social_media: "Social media / gestão de conteúdo",
  paid_media: "Gestão de tráfego / mídia paga",
  consultancy: "Consultoria",
  production_company: "Produtora / estúdio",
  freelancer: "Freelancer com carteira de clientes",
  other: "Outro modelo",
};

const serviceOptions = [
  "Social media",
  "Criação de conteúdo",
  "Design",
  "Vídeo",
  "Tráfego pago",
  "Branding",
  "Consultoria de marketing",
  "Automação/CRM",
  "Sites/landing pages",
  "Outro",
];

export default function PartnerLanding() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [businessType, setBusinessType] = useState<PartnerBusinessType>("agency");
  const [activeClients, setActiveClients] = useState(5);
  const [monthlyRevenue, setMonthlyRevenue] = useState("");
  const [currentServices, setCurrentServices] = useState<string[]>(["Social media"]);
  const [whyPartner, setWhyPartner] = useState("");
  const [targetClientsWithModo, setTargetClientsWithModo] = useState(5);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const estimatedCost = useMemo(() => {
    if (targetClientsWithModo <= 15) return { plan: "MODO Agency Studio", price: 499, capacity: 15 };
    return { plan: "MODO Agency", price: 999, capacity: 40 };
  }, [targetClientsWithModo]);

  function toggleService(service: string) {
    setCurrentServices((current) =>
      current.includes(service)
        ? current.filter((item) => item !== service)
        : current.length < 12
          ? [...current, service]
          : current,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const normalizedWebsite = websiteUrl && !/^https?:\/\//i.test(websiteUrl) ? `https://${websiteUrl}` : websiteUrl;
      const normalizedInstagram = instagramUrl && !/^https?:\/\//i.test(instagramUrl) ? `https://${instagramUrl}` : instagramUrl;
      await createPartnerApplication({
        name,
        email,
        whatsapp,
        companyName,
        city,
        websiteUrl: normalizedWebsite,
        instagramUrl: normalizedInstagram,
        businessType,
        activeClients,
        monthlyServiceRevenueCents: monthlyRevenue ? Math.round(Number(monthlyRevenue.replace(/[^0-9,.-]/g, "").replace(".", "").replace(",", ".")) * 100) : null,
        currentServices,
        whyPartner,
        targetClientsWithModo,
        consent: true,
      });
      setCompleted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar sua candidatura.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="partner-page">
      <header className="partner-header">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <nav>
          <a href="/agency">MODO Agency</a>
          <a href="#modelo">Modelo</a>
          <a href="#criterios">Quem buscamos</a>
          <a className="partner-header-cta" href="#candidatura">Quero ser Founding Partner</a>
        </nav>
      </header>

      <main>
        {completed ? (
          <section className="partner-success">
            <span className="partner-success-icon">✓</span>
            <small>CANDIDATURA RECEBIDA</small>
            <h1>Sua empresa entrou na seleção dos MODO Founding Partners.</h1>
            <p>Vamos avaliar carteira atual, modelo de entrega e aderência. O objetivo é começar com poucos parceiros que já atendem clientes e querem criar uma operação recorrente usando a infraestrutura da MODO.</p>
            <div className="partner-next-steps">
              <strong>Próximos passos</strong>
              <span>1. Revisão da candidatura.</span>
              <span>2. Conversa rápida de alinhamento quando houver aderência.</span>
              <span>3. Definição do primeiro grupo de clientes piloto.</span>
              <span>4. Ativação do MODO Agency e acompanhamento do programa Founding.</span>
            </div>
            <div className="partner-success-actions"><a className="button button-primary" href="/agency">Conhecer MODO Agency</a><a className="text-link" href="/">Voltar para MODO</a></div>
          </section>
        ) : (
          <>
            <section className="partner-hero">
              <div className="partner-hero-copy">
                <div className="section-kicker">MODO PARTNER · FOUNDING COHORT</div>
                <h1>Sua agência vende o relacionamento. <strong>A MODO coloca uma infraestrutura de marketing por trás.</strong></h1>
                <p>Atenda mais clientes, amplie sua entrega e crie uma linha de receita recorrente usando MODO Agency para estratégia, criação, aprovação, publicação e aprendizado.</p>
                <div className="partner-hero-actions"><a className="button button-primary" href="#candidatura">Quero ser Founding Partner</a><a className="text-link" href="#modelo">Entender o modelo ↓</a></div>
                <div className="partner-proof"><span>Programa por seleção</span><span>Sem taxa de candidatura</span><span>Sem promessa de faturamento</span><span>Operação via MODO Agency</span></div>
              </div>
              <aside className="partner-economics">
                <small>A LÓGICA</small>
                <strong>Você não revende uma licença.</strong>
                <p>Você vende seu serviço de marketing com uma operação muito mais completa por trás.</p>
                <div><span>SEU CLIENTE</span><b>Contrata sua agência</b></div>
                <div><span>SUA AGÊNCIA</span><b>Opera relacionamento e entrega</b></div>
                <div><span>MODO</span><b>Estrutura inteligência e execução</b></div>
              </aside>
            </section>

            <section className="partner-model" id="modelo">
              <div className="partner-section-heading"><small>O MODELO</small><h2>Agência é cliente da MODO Agency. <strong>Partner é canal de distribuição.</strong></h2><p>O programa não transforma a MODO em franquia. Ele equipa profissionais que já vendem serviços para operar mais clientes com método e tecnologia.</p></div>
              <div className="partner-model-grid">
                <article><span>01</span><h3>Venda sua própria oferta</h3><p>Você define escopo e preço para o cliente final. A MODO não exige que a agência venda um pacote engessado.</p></article>
                <article><span>02</span><h3>Use MODO Agency por trás</h3><p>Cada cliente vira uma marca com memória, direção, criação, aprovação, Publisher e aprendizado.</p></article>
                <article><span>03</span><h3>Ganhe capacidade operacional</h3><p>Automatize o trabalho repetitivo e preserve o julgamento, a criatividade e o relacionamento da agência.</p></article>
                <article><span>04</span><h3>Aprenda junto com a rede</h3><p>Founding Partners ajudam a definir playbooks, benchmarks e recursos que realmente aumentam capacidade e margem.</p></article>
              </div>
            </section>

            <section className="partner-value">
              <div className="partner-section-heading"><small>O QUE O PARCEIRO RECEBE</small><h2>Uma fábrica de marketing. <strong>Não uma coleção de prompts.</strong></h2></div>
              <div className="partner-value-grid">
                <article><b>Base Estratégica por cliente</b><p>Contexto, oferta, posicionamento, público, provas e personalidade deixam de se perder entre ferramentas.</p></article>
                <article><b>Director + Intelligence</b><p>A MODO ajuda a decidir o que fazer antes de sair produzindo conteúdo.</p></article>
                <article><b>Criação + aprovação</b><p>Conteúdo entra em fluxo claro de produção, revisão e aprovação do cliente.</p></article>
                <article><b>Publisher + agenda</b><p>Publicação e agendamento ficam conectados à mesma operação.</p></article>
                <article><b>Analytics + Learning</b><p>O histórico real alimenta as próximas decisões, em vez de cada mês começar do zero.</p></article>
                <article><b>Playbook Founding</b><p>Estrutura comercial, onboarding e operação serão construídos com a primeira coorte de parceiros.</p></article>
              </div>
            </section>

            <section className="partner-criteria" id="criterios">
              <div className="partner-section-heading"><small>QUEM BUSCAMOS AGORA</small><h2>Gente que já vende serviço. <strong>Não gente procurando um atalho de renda com IA.</strong></h2></div>
              <div className="partner-criteria-grid">
                <div><strong>Boa aderência</strong><ul><li>Agências pequenas e médias</li><li>Social medias com carteira própria</li><li>Gestores de tráfego ampliando oferta</li><li>Consultorias de marketing</li><li>Produtoras e freelancers com clientes ativos</li></ul></div>
                <div><strong>Não é o foco desta coorte</strong><ul><li>Quem nunca vendeu serviço</li><li>Quem busca renda automática</li><li>Quem quer apenas revender login</li><li>Quem depende de promessas de viralização</li><li>Quem não quer participar do onboarding dos clientes</li></ul></div>
              </div>
            </section>

            <section className="partner-math">
              <div><small>EXEMPLO DE CAPACIDADE</small><h2>{estimatedCost.plan}</h2><p>Para a meta informada de <strong>{targetClientsWithModo} clientes</strong>, a candidatura é compatível com uma estrutura de referência de até {estimatedCost.capacity} clientes no plano de R$ {estimatedCost.price}/mês.</p><small>Exemplo baseado na capacidade atual dos planos MODO Agency. Preço cobrado pela agência ao cliente final é decisão da própria agência.</small></div>
              <div className="partner-loop"><span>CONQUISTAR</span><i>→</i><span>ONBOARDING</span><i>→</i><span>OPERAR</span><i>→</i><span>APRENDER</span><i>→</i><span>EXPANDIR</span></div>
            </section>

            <section className="partner-application" id="candidatura">
              <div className="partner-section-heading"><small>CANDIDATURA FOUNDING PARTNER</small><h2>Quer construir essa nova linha de receita <strong>com a MODO por trás?</strong></h2><p>Estamos começando pequeno. Conte sobre sua operação atual e onde a MODO poderia aumentar sua capacidade.</p></div>
              <form onSubmit={submit}>
                {error && <div className="portal-error">{error}</div>}
                <div className="partner-form-grid">
                  <label>Seu nome<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
                  <label>E-mail profissional<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <label>WhatsApp<input required value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} /></label>
                  <label>Empresa / agência<input required value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
                  <label>Cidade/UF<input value={city} onChange={(event) => setCity(event.target.value)} /></label>
                  <label>Tipo de operação<select value={businessType} onChange={(event) => setBusinessType(event.target.value as PartnerBusinessType)}>{(Object.keys(businessTypeLabels) as PartnerBusinessType[]).map((type) => <option key={type} value={type}>{businessTypeLabels[type]}</option>)}</select></label>
                  <label>Clientes ativos hoje<input type="number" min="0" max="10000" value={activeClients} onChange={(event) => setActiveClients(Number(event.target.value))} /></label>
                  <label>Quantos clientes gostaria de operar com MODO?<input type="number" min="1" max="1000" value={targetClientsWithModo} onChange={(event) => setTargetClientsWithModo(Number(event.target.value))} /></label>
                  <label>Site <span>(opcional)</span><input placeholder="https://" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} /></label>
                  <label>Instagram <span>(opcional)</span><input placeholder="https://instagram.com/..." value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} /></label>
                  <label>Receita mensal aproximada com serviços <span>(opcional)</span><input inputMode="decimal" placeholder="Ex.: 15000" value={monthlyRevenue} onChange={(event) => setMonthlyRevenue(event.target.value)} /></label>
                </div>
                <fieldset><legend>O que você já vende hoje?</legend><div className="partner-service-grid">{serviceOptions.map((service) => <button type="button" key={service} className={currentServices.includes(service) ? "selected" : ""} onClick={() => toggleService(service)}>{service}</button>)}</div></fieldset>
                <label>Por que você quer ser MODO Partner?<textarea required minLength={40} value={whyPartner} onChange={(event) => setWhyPartner(event.target.value)} placeholder="Conte como sua operação funciona hoje, onde perde capacidade e o que gostaria de entregar melhor para seus clientes." /></label>
                <label className="partner-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Autorizo a MODO a armazenar estes dados para avaliar a candidatura e entrar em contato sobre o programa. A candidatura não garante aprovação, exclusividade, receita ou resultado comercial.</span></label>
                <button className="button button-primary button-full" disabled={submitting || !consent || currentServices.length === 0}>{submitting ? "Enviando candidatura..." : "Quero ser Founding Partner"}</button>
              </form>
            </section>
          </>
        )}
      </main>
      <footer className="partner-footer"><img src="/logo.svg" alt="MODO" /><p>MODO Partner · infraestrutura de marketing para quem já atende clientes.</p><a href="/politica-de-privacidade">Privacidade</a></footer>
    </div>
  );
}
