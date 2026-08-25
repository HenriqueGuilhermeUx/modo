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

      <style>{`.intelligence-trial-banner{width:min(1320px,100%);margin:0 auto 14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:20px 22px;border-radius:20px;background:linear-gradient(135deg,#0d1b3e,#17377b);color:#fff;box-sizing:border-box;box-shadow:0 18px 45px rgba(13,27,62,.16)}.intelligence-trial-banner small,.intelligence-preview-lock small{display:block;font:900 9px Sora,sans-serif;letter-spacing:.12em;color:#51e0ad;margin-bottom:6px}.intelligence-trial-banner strong{display:block;font:800 19px Sora,sans-serif}.intelligence-trial-banner p{margin:6px 0 0;color:#c8d4eb;font-size:12px;line-height:1.55}.intelligence-trial-banner>a{display:inline-flex;align-items:center;justify-content:center;padding:12px 15px;border-radius:12px;background:#fff;color:#0d1b3e;font-size:11px;font-weight:900;text-decoration:none;white-space:nowrap}.intelligence-preview-lock{width:min(1320px,100%);margin:14px auto 0;display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:18px;align-items:center;padding:22px;border:1px solid #cad8ef;border-radius:20px;background:linear-gradient(180deg,#fff,#f4f8ff);box-sizing:border-box;box-shadow:0 16px 40px rgba(21,48,104,.07)}.intelligence-preview-lock-icon{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:#1f5eff;color:#fff;font:900 22px Sora,sans-serif}.intelligence-preview-lock small{color:#1f5eff}.intelligence-preview-lock h3{margin:0;font:800 18px/1.3 Sora,sans-serif;color:#0d1b3e}.intelligence-preview-lock p{margin:6px 0 0;color:#5d6980;font-size:11px;line-height:1.55}.intelligence-preview-lock .button{white-space:nowrap}.intelligence-trial-banner+.commercial-results{margin-top:0}@media(max-width:820px){.intelligence-trial-banner,.intelligence-preview-lock{grid-template-columns:1fr}.intelligence-trial-banner>a,.intelligence-preview-lock .button{width:100%;box-sizing:border-box}.intelligence-preview-lock-icon{display:none}}`}</style>
    </>
  );
}
