import type { IntelligenceMission } from "@modo/contracts/intelligence";
import { useEffect, useMemo, useState } from "react";
import IntelligenceLeadPipeline from "./IntelligenceLeadPipeline";
import IntelligenceMarketRadarResults from "./IntelligenceMarketRadarResults";
import {
  getIntelligencePlaybooks,
  type IntelligenceLeadItem,
  type IntelligenceQuota,
} from "./intelligence-api";

interface Props {
  mission: IntelligenceMission;
  items: Record<string, unknown>[];
  onClose: () => void;
}

const TRIAL_PREVIEW_ITEMS = 5;

export default function IntelligenceCommercialResults({ mission, items, onClose }: Props) {
  const [quota, setQuota] = useState<IntelligenceQuota | null>(null);

  useEffect(() => {
    let active = true;
    getIntelligencePlaybooks()
      .then((engine) => { if (active) setQuota(engine.quota); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const trial = quota?.plan === "trial";
  const visibleItems = useMemo(
    () => trial ? items.slice(0, TRIAL_PREVIEW_ITEMS) : items,
    [items, trial],
  );
  const totalFound = Math.max(Number(mission.resultCount || 0), items.length);
  const hiddenCount = trial ? Math.max(0, totalFound - visibleItems.length) : 0;

  let content;
  if (mission.playbook === "market_radar") {
    content = <IntelligenceMarketRadarResults mission={mission} items={visibleItems} onClose={onClose} />;
  } else if (mission.playbook === "b2b_prospecting") {
    content = (
      <IntelligenceLeadPipeline
        mission={mission}
        items={visibleItems as IntelligenceLeadItem[]}
        onClose={onClose}
      />
    );
  } else {
    content = (
      <section className="commercial-results">
        <div className="commercial-results-head">
          <div>
            <small>MONITORAMENTO DE PREÇOS</small>
            <h2>{mission.name}</h2>
            <p>O painel estruturado de preços será ativado junto com a Task específica deste playbook.</p>
          </div>
          <div className="commercial-results-actions"><button type="button" onClick={onClose}>Fechar</button></div>
        </div>
      </section>
    );
  }

  return (
    <>
      {trial && (
        <section className="intelligence-trial-banner">
          <div>
            <small>MODO INTELLIGENCE · EXPERIÊNCIA INICIAL</small>
            <strong>Sua primeira pesquisa está funcionando com dados reais.</strong>
            <p>
              A MODO coletou {totalFound} resultado{totalFound === 1 ? "" : "s"} nesta missão.
              {visibleItems.length > 0 ? ` Você está vendo uma prévia de até ${visibleItems.length}.` : ""}
            </p>
          </div>
          <a href="/app/planos">Ver planos de Intelligence ↗</a>
        </section>
      )}

      {content}

      {trial && (
        <section className="intelligence-preview-lock">
          <div className="intelligence-preview-lock-icon">M</div>
          <div>
            <small>PRÉVIA CONCLUÍDA</small>
            <h3>{hiddenCount > 0 ? `${hiddenCount} resultado${hiddenCount === 1 ? "" : "s"} desta coleta ainda não estão nesta prévia.` : "A experiência inicial mostrou como a MODO enxerga o mercado."}</h3>
            <p>Planos completos ampliam a franquia de pesquisas, o volume por missão e o uso contínuo do Radar, Prospecção B2B e demais playbooks disponíveis.</p>
          </div>
          <a className="button button-primary" href="/app/planos">Desbloquear Intelligence completa</a>
        </section>
      )}
    </>
  );
}
