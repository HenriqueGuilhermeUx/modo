import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import UsLanding from "./UsLanding";
import USWorkspace from "./USWorkspace";

const path = window.location.pathname.replace(/\/$/, "") || "/";
const route = path === "/" ? "/us" : path;
const components: Record<string, React.ReactElement> = {
  "/us": <UsLanding product="modo" />,
  "/us/demo": <USWorkspace product="modo" />,
};
const selected = Object.prototype.hasOwnProperty.call(components, route) ? components[route] : null;
createRoot(document.getElementById("root")!).render(
  <StrictMode>{selected ?? <main lang="en-US" style={{fontFamily:"system-ui",padding:"3rem"}}><h1>Page unavailable</h1><p>This USA preview does not provide Brazilian accounts or operational routes.</p><a href="/us">Back to USA preview</a></main>}</StrictMode>
);
