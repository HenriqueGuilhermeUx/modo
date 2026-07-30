import type { SpecialistRole } from "@modo/contracts/strategy-network";
import { type FormEvent, useState } from "react";
import { createSpecialistApplication } from "./strategy-network-api";

const roleLabels: Record<SpecialistRole, string> = {
  strategist: "Estratégia e planejamento",
  art_director: "Direção de arte",
  copywriter: "Copywriting",
  designer: "Design",
  creative: "Criação publicitária",
  motion_designer: "Motion design",
  video_editor: "Edição de vídeo",
  paid_media_specialist: "Tráfego e mídia paga",
  account_manager: "Atendimento e gestão de contas",
  other: "Outra especialidade",
};

export default function SpecialistApplicationPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [city, setCity] = useState("");
  const [primaryRole, setPrimaryRole] = useState<SpecialistRole>("designer");
  const [secondaryRoles, setSecondaryRoles] = useState<SpecialistRole[]>([]);
  const [experienceYears, setExperienceYears] = useState(1);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [availability, setAvailability] = useState<"project" | "part_time" | "recurring" | "full_time_interest">("project");
  const [engagementPreference, setEngagementPreference] = useState<"freelance" | "partner" | "contractor" | "open">("open");
  const [about, setAbout] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  function toggleRole(role: SpecialistRole) {
    if (role === primaryRole) return;
    setSecondaryRoles((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : current.length < 6 ? [...current, role] : current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await createSpecialistApplication({
        name,
        email,
        whatsapp,
        city,
        primaryRole,
        secondaryRoles,
        experienceYears,
        portfolioUrl,
        linkedinUrl,
        availability,
        engagementPreference,
        about,
        consent: true,
      });
      setCompleted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar seu perfil.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="talent-page discreet-talent-page">
      <header className="talent-header">
        <a href="/"><img src="/logo.svg" alt="MODO" /></a>
        <nav><a href="/">Modo</a><a className="active" href="/rede-modo/convite">Cadastro por convite</a><a href="/app">Entrar</a></nav>
      </header>

      <main>
        {completed ? (
          <section className="talent-success">
            <span>✓</span>
            <small>PERFIL RECEBIDO</small>
            <h1>Seu portfólio entrou na curadoria interna da Modo.</h1>
            <p>O cadastro não cria perfil público nem distribui projetos automaticamente. O contato acontecerá apenas quando houver aderência real com uma necessidade de cliente.</p>
            <div><strong>Próximas etapas</strong><span>1. Revisão do perfil e do portfólio.</span><span>2. Contato somente quando houver compatibilidade.</span><span>3. Alinhamento de escopo e confidencialidade.</span><span>4. Convite pontual para um projeto ou banco curado.</span></div>
            <a className="button button-primary" href="/">Voltar para a Modo</a>
          </section>
        ) : (
          <>
            <section className="talent-hero discreet-talent-hero">
              <div><div className="section-kicker">CADASTRO POR CONVITE</div><h1>Curadoria interna de profissionais.</h1><p>Esta página é destinada a profissionais convidados pela Modo. Buscamos pessoas que combinem julgamento, qualidade técnica e uso responsável de tecnologia.</p><div className="talent-pills"><span>Projetos pontuais</span><span>Briefing organizado</span><span>Curadoria de qualidade</span><span>Sem perfil público</span></div></div>
              <aside><small>REDE EM FASE PILOTO</small><strong>Cadastro não significa contratação.</strong><p>A Modo avalia portfólio, disponibilidade e compatibilidade antes de qualquer contato ou compartilhamento de contexto de cliente.</p></aside>
            </section>

            <section className="talent-principles">
              <article><span>01</span><strong>Convites pontuais</strong><p>A rede não funciona como mural aberto de vagas ou leilão de preço.</p></article>
              <article><span>02</span><strong>Cliente protegido</strong><p>Dados, escopo e acessos só são compartilhados depois de autorização e alinhamento.</p></article>
              <article><span>03</span><strong>Tecnologia como apoio</strong><p>A ferramenta organiza a operação; o profissional entra quando seu julgamento agrega valor.</p></article>
            </section>

            <form className="talent-form" onSubmit={submit}>
              <div className="talent-form-heading"><div><small>PERFIL PROFISSIONAL</small><h2>Conte o que você faz bem.</h2></div><p>Preencha com informações reais. O portfólio é a principal referência da análise.</p></div>
              {error && <div className="portal-error">{error}</div>}
              <div className="talent-form-grid">
                <label>Nome completo<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>E-mail profissional<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <label>WhatsApp<input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} /></label>
                <label>Cidade/UF<input value={city} onChange={(event) => setCity(event.target.value)} /></label>
                <label>Especialidade principal<select value={primaryRole} onChange={(event) => { const next = event.target.value as SpecialistRole; setPrimaryRole(next); setSecondaryRoles((current) => current.filter((item) => item !== next)); }}>{(Object.keys(roleLabels) as SpecialistRole[]).map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label>
                <label>Anos de experiência<input type="number" min="0" max="60" value={experienceYears} onChange={(event) => setExperienceYears(Number(event.target.value))} /></label>
                <label>Portfólio<input required type="url" placeholder="https://" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} /></label>
                <label>LinkedIn <span>(opcional)</span><input type="url" placeholder="https://" value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} /></label>
                <label>Disponibilidade<select value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}><option value="project">Projetos pontuais</option><option value="part_time">Parte do tempo</option><option value="recurring">Trabalho recorrente</option><option value="full_time_interest">Interesse futuro em dedicação integral</option></select></label>
                <label>Forma de colaboração<select value={engagementPreference} onChange={(event) => setEngagementPreference(event.target.value as typeof engagementPreference)}><option value="open">Aberto a formatos</option><option value="freelance">Freelancer por projeto</option><option value="partner">Parceria</option><option value="contractor">Prestação recorrente</option></select></label>
              </div>
              <fieldset><legend>Outras competências</legend><div className="talent-role-grid">{(Object.keys(roleLabels) as SpecialistRole[]).filter((role) => role !== primaryRole).map((role) => <button type="button" className={secondaryRoles.includes(role) ? "selected" : ""} onClick={() => toggleRole(role)} key={role}>{roleLabels[role]}</button>)}</div></fieldset>
              <label>Sobre seu trabalho<textarea required minLength={40} value={about} onChange={(event) => setAbout(event.target.value)} placeholder="Tipos de projeto, segmentos, forma de pensar, ferramentas e trabalhos que melhor representam você." /></label>
              <label className="talent-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Autorizo a Modo a armazenar estes dados para avaliar meu perfil e entrar em contato sobre oportunidades profissionais. O cadastro não garante contratação ou projeto.</span></label>
              <button className="button button-primary button-full" disabled={submitting || !consent}>{submitting ? "Enviando perfil..." : "Enviar perfil para curadoria"}</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
