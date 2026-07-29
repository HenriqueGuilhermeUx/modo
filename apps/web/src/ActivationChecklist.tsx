import { useEffect, useState } from "react";
import { getActivationSummary, type ActivationSummary } from "./activation-api";

function formatCompletedAt(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export default function ActivationChecklist() {
  const [summary, setSummary] = useState<ActivationSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getActivationSummary()
      .then(setSummary)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua jornada."));
  }, []);

  if (error) return null;
  if (!summary) {
    return (
      <section className="activation-card activation-loading">
        <div className="portal-spinner" />
        <p>Organizando seu próximo passo...</p>
      </section>
    );
  }

  return (
    <section className={`activation-card ${summary.activated ? "completed" : ""}`}>
      <div className="activation-heading">
        <div>
          <small>{summary.activated ? "PRIMEIRO CICLO CONCLUÍDO" : "SUA JORNADA NA MODO"}</small>
          <h2>{summary.activated ? "Sua operação já consegue criar, aprovar e exportar." : "Um próximo passo por vez."}</h2>
          <p>{summary.activated ? "Agora a Modo pode repetir o processo, aprender com os resultados e ampliar campanhas." : "A Modo mostra o que falta para você chegar à primeira entrega pronta para uso."}</p>
        </div>
        <div className="activation-score">
          <strong>{summary.progress}%</strong>
          <span>{summary.completedCount}/{summary.totalSteps} etapas</span>
        </div>
      </div>

      <div className="activation-progress" aria-label={`${summary.progress}% concluído`}>
        <span style={{ width: `${summary.progress}%` }} />
      </div>

      <div className="activation-steps">
        {summary.steps.map((step, index) => (
          <article className={step.completed ? "done" : ""} key={step.id}>
            <span>{step.completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.description}</p>
            </div>
            {step.completedAt && <small>{formatCompletedAt(step.completedAt)}</small>}
          </article>
        ))}
      </div>

      <div className="activation-next">
        <div>
          <small>{summary.activated ? "PRÓXIMO CICLO" : "PRÓXIMA AÇÃO"}</small>
          <strong>{summary.nextAction.label}</strong>
          <p>{summary.nextAction.description}</p>
        </div>
        <a className="button button-primary" href={summary.nextAction.path}>{summary.nextAction.label} →</a>
      </div>

      <p className="activation-trust">A Modo acompanha apenas ações dentro da sua operação para simplificar a jornada. Nada é publicado automaticamente.</p>
    </section>
  );
}
