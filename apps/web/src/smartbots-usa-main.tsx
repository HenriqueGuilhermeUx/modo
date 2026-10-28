import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SmartBotsUSLanding from "./SmartBotsUSLanding";
import USWorkspace from "./USWorkspace";

const path = location.pathname.replace(/\/$/, "") || "/";
const content = path === "/" ? <SmartBotsUSLanding /> :
  path === "/demo" ? <USWorkspace product="smartbots" /> :
  <main lang="en-US" style={{fontFamily:"system-ui",padding:"3rem"}}>
    <h1>Page unavailable</h1><p>SmartBots USA preview only. No Brazilian app or accounts are available.</p>
    <a href="/">Home</a>
  </main>;
createRoot(document.getElementById("root")!).render(<StrictMode>{content}</StrictMode>);
