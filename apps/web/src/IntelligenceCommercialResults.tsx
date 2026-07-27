import type { IntelligenceMission } from "@modo/contracts/intelligence";
import IntelligenceLeadPipeline from "./IntelligenceLeadPipeline";
import IntelligenceMarketRadarResults from "./IntelligenceMarketRadarResults";
import type { IntelligenceLeadItem } from "./intelligence-api";

interface Props {
  mission: IntelligenceMission;
  items: Record<string, unknown>[];
  onClose: () => void;
}

export default function IntelligenceCommercialResults({ mission, items, onClose }: Props) {
  if (mission.playbook === "market_radar") {
    return (
      <IntelligenceMarketRadarResults
        mission={mission}
        items={items}
        onClose={onClose}
      />
    );
  }

  if (mission.playbook === "b2b_prospecting") {
    return (
      <IntelligenceLeadPipeline
        mission={mission}
        items={items as IntelligenceLeadItem[]}
        onClose={onClose}
      />
    );
  }

  return (
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
