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
            <p>Não é uma classificação genérica. É o primeiro ponto que merece ação com base no que a página comunica hoje.</p>
          </div>
          <div className="impact-result-badge"><span>✓</span> Página analisada</div>
        </div>

        <article className="impact-diagnosis">
          <div className="impact-diagnosis-index">01</div>
          <div className="impact-diagnosis-main">
            <small>O PONTO QUE PODE ESTAR FAZENDO O VISITANTE ESCAPAR</small>
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
              <small>PRIMEIRO MOVIMENTO RECOMENDADO</small>
              <p>{result.diagnosis.recommendation}</p>
            </div>
          </div>
        </article>

        {firstCampaign && (
          <section className="impact-preview">
            <div className="impact-preview-heading">
              <div>
                <div className="section-kicker">A MODO JÁ COMEÇOU</div>
                <h2>Uma ideia concreta para você não sair apenas com teoria.</h2>
              </div>
              <span>Campanha 01 liberada</span>
            </div>

            <article className="impact-campaign-preview">
              <div className="impact-campaign-label"><span>01</span><b>{firstCampaign.eyebrow}</b></div>
              <div className="impact-campaign-copy">
                <small>IDEIA CENTRAL</small>
                <h3>{firstCampaign.title}</h3>
                <div className="impact-campaign-details">
                  <div><small>DIREÇÃO VISUAL</small><p>{firstCampaign.visualDirection}</p></div>
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
          <div className="impact-context-heading"><small>LEITURA DE CONTEXTO</small><p>Como a MODO interpretou a marca antes de criar a recomendação.</p></div>
          <div className="summary-strip impact-summary-strip">
            <div><small>Segmento percebido</small><strong>{result.brandSummary.segment}</strong></div>
            <div><small>Oferta percebida</small><strong>{result.brandSummary.primaryOffer}</strong></div>
            <div><small>Público percebido</small><strong>{result.brandSummary.audience}</strong></div>
          </div>
        </section>

        {!leadCaptured ? (
          <form className="impact-lead-capture" onSubmit={onLeadSubmit}>
            <div>
              <small>VOCÊ JÁ RECEBEU O DIAGNÓSTICO + 1 CAMPANHA</small>
              <h3>Libere mais duas direções prontas para sua marca.</h3>
              <p>Uma para geração de demanda e outra para conexão humana.</p>
            </div>
            <div className="impact-lead-fields">
              <input placeholder="Seu nome" value={name} onChange={(event) => onNameChange(event.target.value)} required />
              <input placeholder="WhatsApp ou e-mail" value={contact} onChange={(event) => onContactChange(event.target.value)} required />
              <button className="button button-primary" disabled={leadLoading}>{leadLoading ? "Liberando..." : "Liberar mais 2 ideias"}</button>
            </div>
            <small className="consent-copy">Ao continuar, você aceita receber contato sobre a MODO.</small>
          </form>
        ) : (
          <div className="impact-lead-success">
            <span>✓</span>
            <div><strong>Plano completo liberado.</strong><p>As outras duas direções estão abertas abaixo.</p></div>
            <button className="button button-primary" onClick={onActivate}>Transformar isso em rotina</button>
          </div>
        )}

        <div className="impact-more-heading">
          <div><div className="section-kicker">OUTRAS DIREÇÕES</div><h2>Mais dois caminhos para a presença da marca.</h2></div>
          <p>Autoridade sozinha não sustenta o ciclo. A MODO também trabalha demanda e conexão.</p>
        </div>

        <div className="impact-more-grid">
          {additionalCampaigns.map((campaign, index) => {
            const locked = !leadCaptured;
            return (
              <article className={locked ? "campaign-card impact-more-card locked" : "campaign-card impact-more-card"} key={campaign.id}>
                <div className="campaign-top"><span>0{index + 2}</span><b>{campaign.eyebrow}</b></div>
                <h3>{campaign.title}</h3>
                <small>Direção visual</small><p>{campaign.visualDirection}</p>
                <small>Legenda</small><p>{campaign.caption}</p>
                <div className="campaign-tags">{campaign.hashtags.join(" ")}</div>
                <div className="campaign-cta">{campaign.cta}</div>
                {locked && <div className="lock-layer"><div className="lock-icon">↗</div><strong>Mais uma direção encontrada</strong><span>Libere acima para ver o conteúdo completo.</span></div>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
