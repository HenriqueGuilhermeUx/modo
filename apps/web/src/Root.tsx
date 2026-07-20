import App from "./App";
import ContentWorkspace from "./ContentWorkspace";
import Portal from "./Portal";

export default function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/app/content")) return <ContentWorkspace />;
  if (path.startsWith("/app")) {
    return (
      <>
        <Portal />
        <a className="portal-workspace-entry" href="/app/content">Criar conteúdo ↗</a>
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
