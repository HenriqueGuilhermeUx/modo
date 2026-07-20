import type { ContentRequest } from "@modo/contracts/content";
import { useEffect, useMemo, useState } from "react";

const steps = [
  "Lendo o contexto da marca",
  "Definindo o ângulo e o gancho",
  "Escrevendo e estruturando",
  "Validando a entrega final",
];

export default function ProductionProgress({ request }: { request: ContentRequest }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.round((now - new Date(request.updatedAt).getTime()) / 1000));
  const activeIndex = useMemo(() => {
    if (elapsed < 8) return 0;
    if (elapsed < 22) return 1;
    if (elapsed < 45) return 2;
    return 3;
  }, [elapsed]);

  return (
    <div className="production-progress">
      <div className="production-progress-head">
        <div className="creative-director-avatar small">CD</div>
        <div>
          <strong>Diretor de Criação em ação</strong>
          <p>{steps[activeIndex]}</p>
        </div>
        <span>{elapsed}s</span>
      </div>
      <div className="production-progress-bar"><span style={{ width: `${Math.min(94, 18 + activeIndex * 24 + elapsed / 4)}%` }} /></div>
      <div className="production-step-list">
        {steps.map((step, index) => (
          <div className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={step}>
            <i>{index < activeIndex ? "✓" : index + 1}</i><span>{step}</span>
          </div>
        ))}
      </div>
      <small>{elapsed > 75 ? "A produção está levando um pouco mais de tempo, mas continua ativa. Você pode sair da página e voltar depois." : "Você pode acompanhar em tempo real ou continuar usando a plataforma."}</small>
    </div>
  );
}
