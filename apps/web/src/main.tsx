import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import "./styles.css";
import "./pricing.css";
import "./portal.css";
import "./workspace.css";
import "./portal-action.css";
import "./billing.css";
import "./billing-lifecycle.css";
import "./creative-director.css";
import "./landing-enhancements.css";
import "./director.css";
import "./director-prefill.css";
import "./linkedin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
