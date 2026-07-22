import type { DiagnosticJob } from "@modo/contracts";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import App from "./App";
import { captureLead } from "./api";
import DiagnosticImpactResult from "./DiagnosticImpactResult";

const CACHE_KEY = "modo.lastDiagnostic";

function readCompletedJob(): DiagnosticJob | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagnosticJob;
    return parsed.status === "completed" && parsed.result ? parsed : null;
  } catch {
    return null;
  }
}

export default function ImpactLanding() {
  const [job, setJob] = useState<DiagnosticJob | null>(() => readCompletedJob());
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [leadLoading, setLeadLoading] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const result = job?.result;
  const campaigns = useMemo(() => result?.campaigns ?? [], [result]);

  useEffect(() => {
    const refresh = () => {
      const next = readCompletedJob();
      setJob((current) => current?.id === next?.id && current?.completedAt === next?.completedAt ? current : next);
    };
    refresh();
    const timer = window.setInterval(refresh, 450);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!result) {
      document.getElementById("modo-impact-result-root")?.remove();
      setTarget(null);
      return;
    }

    let root = document.getElementById("modo-impact-result-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "modo-impact-result-root";
      const howSection = document.querySelector(".how-section");
      howSection?.parentElement?.insertBefore(root, howSection);
    }
    setTarget(root);
    const timer = window.setTimeout(() => root?.scrollIntoView({ behavior: "smooth", block: "start" }), 320);
    return () => window.clearTimeout(timer);
  }, [job?.id, result]);

  async function handleLead(event: FormEvent) {
    event.preventDefault();
    if (!job) return;
    setLeadLoading(true);
    try {
      await captureLead({ diagnosticId: job.id, name, contact, consent: true });
      setLeadCaptured(true);
    } finally {
      setLeadLoading(false);
    }
  }

  function activatePlan() {
    window.sessionStorage.setItem("modo.selectedPlan", "presenca");
    const targetUrl = import.meta.env.VITE_CHECKOUT_URL || import.meta.env.VITE_WHATSAPP_URL;
    if (targetUrl) {
      const separator = targetUrl.includes("?") ? "&" : "?";
      window.location.href = `${targetUrl}${separator}plan=presenca`;
      return;
    }
    window.location.href = "/app/onboarding";
  }

  return (
    <>
      <App />
      {target && result && createPortal(
        <DiagnosticImpactResult
          result={result}
          campaigns={campaigns}
          leadCaptured={leadCaptured}
          leadLoading={leadLoading}
          name={name}
          contact={contact}
          sectionRef={resultRef}
          onNameChange={setName}
          onContactChange={setContact}
          onLeadSubmit={handleLead}
          onActivate={activatePlan}
        />,
        target,
      )}
    </>
  );
}
