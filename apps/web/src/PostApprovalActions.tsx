import { contentCreditCost, type ContentUnitType } from "@modo/contracts";
import type { ContentRequest } from "@modo/contracts/content";
import CanvaApprovalAction from "./CanvaApprovalAction";
import InstagramApprovalAction from "./InstagramApprovalAction";

interface Props {
  request: ContentRequest;
  creditsRemaining: number;
  workingTarget: ContentUnitType | "";
  onGenerate: (target: ContentUnitType) => void;
}

const derivativeOptions: Array<{
  type: ContentUnitType;
  title: string;
  description: string;
}> = [
  {
    type: "carousel",
    title: "Gerar carrossel visual",
    description: "Cria a sequência, as copies e as imagens individuais dos slides.",
  },
  {
    type: "story",
    title: "Gerar Stories visuais",
    description: "Cria três Stories consistentes com a peça aprovada.",
  },
];

export default function PostApprovalActions({
  request,
  creditsRemaining,
  workingTarget,
  onGenerate,
}: Props) {
  const available = derivativeOptions.filter((option) => option.type !== request.contentType);

  return (
    <section className="post-approval-workspace" id={`post-approval-${request.id}`}>
      <div className="post-approval-heading">
        <div>
          <small>CONTEÚDO APROVADO</small>
          <h3>Escolha o próximo passo</h3>
          <p>A aprovação encerra a revisão desta peça. Nada é publicado automaticamente.</p>
        </div>
        <span>✓ Versão protegida</span>
      </div>

      <div className="post-approval-grid">
        <article className="post-approval-card primary">
          <small>ACABAMENTO NA MODO</small>
          <strong>Editar e exportar no Studio</strong>
          <p>Aplique título, CTA e ajustes finais. Depois baixe a peça em PNG.</p>
          <a className="button button-primary" href={`/app/studio/${request.id}`}>Abrir no Studio</a>
        </article>

        <article className="post-approval-card canva-card">
          <CanvaApprovalAction contentRequestId={request.id} />
        </article>

        <article className="post-approval-card instagram-card">
          <InstagramApprovalAction contentRequestId={request.id} />
        </article>
      </div>

      {available.length > 0 && (
        <section className="derivative-workspace">
          <div className="delivery-section-heading">
            <div>
              <small>DESDOBRAR A CAMPANHA</small>
              <h4>Gerar novas peças a partir desta aprovação</h4>
              <p>Cada opção cria um novo pedido, com revisão própria e consumo de créditos informado antes da geração.</p>
            </div>
          </div>
          <div className="derivative-grid">
            {available.map((option) => {
              const cost = contentCreditCost[option.type];
              const insufficient = creditsRemaining < cost;
              const working = workingTarget === option.type;
              return (
                <article key={option.type}>
                  <div>
                    <strong>{option.title}</strong>
                    <p>{option.description}</p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={Boolean(workingTarget) || insufficient}
                    onClick={() => onGenerate(option.type)}
                  >
                    {working ? "Criando novo pedido..." : insufficient ? "Saldo insuficiente" : `Gerar · ${cost} crédito${cost > 1 ? "s" : ""}`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="post-approval-curation-note">
        <span>Esta entrega pede uma segunda opinião?</span>
        <a href={`/app/especialista?content=${request.id}`}>Solicitar curadoria da Modo</a>
      </div>
    </section>
  );
}
