import App from "./App";
import BillingWorkspace from "./BillingWorkspace";
import ContentWorkspace from "./ContentWorkspace";
import Portal from "./Portal";

export default function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/app/planos")) return <BillingWorkspace />;
  if (path.startsWith("/app/content")) return <ContentWorkspace />;
  if (path.startsWith("/app")) {
    return (
      <>
        <Portal />
        <div className="portal-floating-actions">
          <a className="portal-plan-entry" href="/app/planos">Planos</a>
          <a className="portal-workspace-entry" href="/app/content">Criar conteúdo ↗</a>
        </div>
      </>
    );
  }

  return (
    <>
      <App />
      <a className="portal-entry" href="/app">Entrar</a>
    </>
  );
}
