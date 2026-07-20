import App from "./App";
import ContentWorkspace from "./ContentWorkspace";
import Portal from "./Portal";

export default function Root() {
  const path = window.location.pathname;
  if (path.startsWith("/app/content")) return <ContentWorkspace />;
  if (path.startsWith("/app")) return <Portal />;

  return (
    <>
      <App />
      <a className="portal-entry" href="/app">Entrar</a>
    </>
  );
}
