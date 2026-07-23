import type { Campaign, DiagnosticResult } from "@modo/contracts";
import type { FormEvent, RefObject } from "react";

interface Props {
  result: DiagnosticResult;
  campaigns: Campaign[];
  leadCaptured: boolean;
  leadLoading: boolean;
  name: string;
  contact: string;
  sectionRef: RefObject<HTMLElement | null>;
  onNameChange: (value: string) => void;
  onContactChange: (value: string) => void;
  onLeadSubmit: (event: FormEvent) => void;
  onActivate: () => void;
}

const actionType: Record<Campaign["objective"], { verb: string; format: string; reason: string }> = {
  autoridade: {
    verb: "Publique",
    format: "POST OU DOCUMENTO",
    reason: "para tornar sua competência visível",
  },
  leads: {
    verb: "Faça um carrossel",
    format: "CARROSSEL",
    reason: "para atrair quem reconhece esse problema",
  },
  conexao: {
    verb: "Grave um vídeo",
    format: "VÍDEO CURTO",
    reason: "para mostrar quem está por trás da empresa",
  },
};

export default function DiagnosticImpactResult({
  result,
  campaigns,
  leadCaptured,
  leadLoading,
  name,
  contact,
  sectionRef,
  onNameChange,
  onContactChange,
  onLeadSubmit,
  onActivate,
}: Props) {
  const firstCampaign = campaigns[0];
  const additionalCampaigns = campaigns.slice(1);

  return (
    <section className="result-section impact-result-section" ref={sectionRef}>
      <div className="container">
        <div className="impact-result-heading">
          <div>
            <div className="section-kicker">A MODO ENCONTROU</div>
            <h2>Existe uma oportunidade clara de ganhar mais atenção em <strong>{result.brandSummary.name}</strong>.</h2>
            <p>Você não receberá apenas uma análise. A MODO já transformou o que encontrou em ações para publicar, demonstrar e vender melhor.</p>
          </div>
          <div className="impact-result-badge"><span>✓</span> Site analisado</div>
        </div>

        <section className="impact-action-plan">
          <div className="impact-action-plan-heading">
            <div>
              <small>FAÇA ISSO AGORA</small>
              <h2>Três movimentos para colocar sua empresa em destaque.</h2>
            </div>
            <p>Os temas abaixo foram escolhidos a partir do que a MODO encontrou no site — não são uma lista genérica de ideias.</p>
          </div>

          <div className="impact-action-grid">
            {campaigns.map((campaign, index) => {
              const action = actionType[campaign.objective];
              return (
                <article key={campaign.id}>
                  <div className="impact-action-top">
                    <span>0{index + 1}</span>
                    <b>{action.format}</b>
                  </div>
                  <small>{action.verb}</small>
                  <h3>{campaign.title}</h3>
                  <p>{action.reason}.</p>
                  {index === 0 ? (
                    <strong className="impact-action-open">Conteúdo completo aberto abaixo ↓</strong>
                  ) : (
                    <strong className="impact-action-locked">Tema revelado · detalhes disponíveis abaixo</strong>
                  )}
                </article>
              );
            })}
          </div>

          {firstCampaign && (
            <div className="impact-action-cta">
              <div><small>CHAMADA RECOMENDADA</small><strong>{firstCampaign.cta}</strong></div>
              <span>Use esta frase no final da primeira publicação.</span>
            </div>
          )}
        </section>

        <article className="impact-diagnosis">
          <div className="impact-diagnosis-index">01</div>
          <div className="impact-diagnosis-main">
            <small>POR QUE ESTES CONTEÚDOS FORAM RECOMENDADOS</small>
            <h3>{result.diagnosis.opportunity}</h3>
          </div>
          <div className="impact-diagnosis-grid">
            <div>
              <small>O QUE ENCONTRAMOS NO SITE</small>
              <p>{result.diagnosis.strength}</p>
            </div>
            <div>
              <small>POR QUE ISSO IMPORTA</small>
              <p>{result.diagnosis.impact}</p>
            </div>
            <div className="impact-next-move">
              <small>DIREÇÃO ESTRATÉGICA</small>
              <p>{result.diagnosis.recommendation}</p>
            </div>
          </div>
        </article>

        {firstCampaign && (
          <section className="impact-preview">
            <div className="impact-preview-heading">
              <div>
                <div className="section-kicker">PRIMEIRA PUBLICAÇÃO PRONTA</div>
                <h2>A MODO já começou a executar o plano.</h2>
              </div>
              <span>Conteúdo 01 liberado</span>
            </div>

            <article className="impact-campaign-preview">
              <div className="impact-campaign-label"><span>01</span><b>{firstCampaign.eyebrow}</b></div>
              <div className="impact-campaign-copy">
                <small>TEMA DA PUBLICAÇÃO</small>
                <h3>{firstCampaign.title}</h3>
                <div className="impact-campaign-details">
                  <div><small>COMO PRODUZIR</small><p>{firstCampaign.visualDirection}</p></div>
                  <div><small>LEGENDA INICIAL</small><p>{firstCampaign.caption}</p></div>
                </div>
                <div className="impact-campaign-footer">
                  <span>{firstCampaign.hashtags.join(" ")}</span>
                  <strong>{firstCampaign.cta}</strong>
                </div>
              </div>
            </article>
          </section>
        )}

        <section className="impact-context">
          <div className="impact-context-heading"><small>LEITURA DE CONTEXTO</small><p>Como a MODO interpretou a marca antes de criar as recomendações.</p></div>
          <div className="summary-strip impact-summary-strip">
            <div><small>Segmento percebido</small><strong>{result.brandSummary.segment}</strong></div>
            <div><small>Oferta percebida</small><strong>{result.brandSummary.primaryOffer}</strong></div>
            <div><small>Público percebido</small><strong>{result.brandSummary.audience}</strong></div>
          </div>
        </section>

        {!leadCaptured ? (
          <form className="impact-lead-capture" onSubmit={onLeadSubmit}>
            <div>
              <small>VOCÊ JÁ VIU OS 3 MOVIMENTOS + 1 CONTEÚDO COMPLETO</small>
              <h3>Libere a execução das outras duas ideias.</h3>
              <p>Receba direção visual, legenda, hashtags e chamada para demanda e conexão humana.</p>
            </div>
            <div className="impact-lead-fields">
              <input placeholder="Seu nome" value={name} onChange={(event) => onNameChange(event.target.value)} required />
              <input placeholder="WhatsApp ou e-mail" value={contact} onChange={(event) => onContactChange(event.target.value)} required />
              <button className="button button-primary" disabled={leadLoading}>{leadLoading ? "Liberando..." : "Liberar outras 2 execuções"}</button>
            </div>
            <small className="consent-copy">Ao continuar, você aceita receber contato sobre a MODO.</small>
          </form>
        ) : (
          <div className="impact-lead-success">
            <span>✓</span>
            <div><strong>Plano completo liberado.</strong><p>As outras duas execuções estão abertas abaixo.</p></div>
            <button className="button button-primary" onClick={onActivate}>Transformar isso em rotina</button>
          </div>
        )}

        <div className="impact-more-heading">
          <div><div className="section-kicker">OUTRAS EXECUÇÕES</div><h2>Mais dois conteúdos para colocar o plano em prática.</h2></div>
          <p>Um para atrair pessoas com o problema e outro para criar confiança mostrando quem está por trás da marca.</p>
        </div>

        <div className="impact-more-grid">
          {additionalCampaigns.map((campaign, index) => {
            const locked = !leadCaptured;
            return (
              <article className={locked ? "campaign-card impact-more-card locked" : "campaign-card impact-more-card"} key={campaign.id}>
                <div className="campaign-top"><span>0{index + 2}</span><b>{campaign.eyebrow}</b></div>
                <h3>{campaign.title}</h3>
                <small>Como produzir</small><p>{campaign.visualDirection}</p>
                <small>Legenda</small><p>{campaign.caption}</p>
                <div className="campaign-tags">{campaign.hashtags.join(" ")}</div>
                <div className="campaign-cta">{campaign.cta}</div>
                {locked && <div className="lock-layer"><div className="lock-icon">↗</div><strong>Tema já revelado</strong><span>Libere acima para receber a execução completa.</span></div>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
