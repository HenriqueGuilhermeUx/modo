import App from "./App";
import Portal from "./Portal";

export default function Root() {
  if (window.location.pathname.startsWith("/app")) return <Portal />;

  return (
    <>
      <App />
      <a className="portal-entry" href="/app">Entrar</a>
    </>
  );
}
