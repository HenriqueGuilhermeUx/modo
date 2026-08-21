import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function AgencyEntryAddon() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.querySelector<HTMLElement>(".fishing-header .header-actions"));
  }, []);

  if (!target) return null;

  return createPortal(
    <a className="agency-entry-link" href="/agency" aria-label="Conhecer MODO Agency">
      MODO AGENCY <span>↗</span>
    </a>,
    target,
  );
}
