import type { IntelligenceMission } from "@modo/contracts/intelligence";
import IntelligenceLeadPipeline from "./IntelligenceLeadPipeline";
import type { IntelligenceLeadItem } from "./intelligence-api";

interface Props {
  mission: IntelligenceMission;
  items: Record<string, unknown>[];
  onClose: () => void;
}

export default function IntelligenceCommercialResults({ mission, items, onClose }: Props) {
  return (
    <IntelligenceLeadPipeline
      mission={mission}
      items={items as IntelligenceLeadItem[]}
      onClose={onClose}
    />
  );
}
