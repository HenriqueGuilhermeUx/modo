import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function PartnerAgencyEntryAddon() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.querySelector<HTMLElement>(".agency-header-actions"));
  }, []);

  if (!target) return null;

  return createPortal(
    <a className="partner-agency-entry" href="/partners" aria-label="Conhecer o programa MODO Partner">
      MODO PARTNER <span>↗</span>
    </a>,
    target,
  );
}
