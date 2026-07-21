import { useEffect, useState } from "react";
import { getDashboard, getSessionToken } from "./api";

export default function PortalWelcomeGuide() {
  const [organizationId, setOrganizationId] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getSessionToken()) return;
    getDashboard()
      .then((dashboard) => {
        const key = `modo.onboardingCompleted:${dashboard.organization.id}`;
        const dismissed = window.localStorage.getItem(`${key}:dismissed`) === "true";
        const completed = window.localStorage.getItem(key) === "true";
        setOrganizationId(dashboard.organization.id);
        setVisible(!completed && !dismissed);
      })
      .catch(() => undefined);
  }, []);

  if (!visible) return null;

  function dismiss() {
    if (organizationId) {
      window.localStorage.setItem(`modo.onboardingCompleted:${organizationId}:dismissed`, "true");
    }
    setVisible(false);
  }

  return (
    <>
      <div className="portal-welcome-guide">
        <div>
          <span className="guide-icon">✦</span>
          <div>
            <strong>Conheça o potencial completo da MODO em poucos minutos.</strong>
            <p>Defina objetivos, LinkedIn e outros canais, pessoas disponíveis e gere seu primeiro plano guiado.</p>
          </div>
        </div>
        <div className="portal-welcome-guide-actions">
          <button type="button" onClick={dismiss}>Agora não</button>
          <a href="/app/onboarding">Começar onboarding</a>
        </div>
      </div>
      <small className="portal-company-note">MODO é uma solução da Alternative Ventures — CNPJ 61.920.356/0001-38.</small>
    </>
  );
}
