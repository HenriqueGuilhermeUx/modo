import fs from "node:fs";

function replace(path, before, after) {
  const current = fs.readFileSync(path, "utf8");
  if (!current.includes(before)) {
    throw new Error(`Trecho não encontrado em ${path}: ${before.slice(0, 120)}`);
  }
  fs.writeFileSync(path, current.replace(before, after));
}

replace(
  "apps/api/src/app.ts",
  `.header("content-type", asset.mimeType)\n      .header("cache-control", "public, max-age=31536000, immutable")`,
  `.header("content-type", asset.mimeType)\n      .header("cache-control", "public, max-age=31536000, immutable")\n      .header("cross-origin-resource-policy", "cross-origin")`,
);

replace(
  "apps/api/src/app.ts",
  `version: "0.14.0",`,
  `version: "0.14.1",`,
);

replace(
  "apps/web/src/ContentWorkspace.tsx",
  `<img src={output.imageUrl} alt={output.imageAlt || output.title} loading="lazy" />`,
  `<img src={output.imageUrl} alt={output.imageAlt || output.title} loading="lazy" crossOrigin="anonymous" />`,
);

replace(
  "apps/web/src/ContentWorkspace.tsx",
  `setSuccess("Conteúdo aprovado. A MODO usará esta decisão nas próximas sugestões.");`,
  `setSuccess("Conteúdo aprovado. A etapa Canva foi liberada abaixo e será preparada automaticamente quando a conta estiver conectada.");`,
);

fs.writeFileSync(
  "apps/web/src/CanvaApprovalAction.tsx",
  `import { useEffect, useState } from "react";
import {
  connectCanva,
  createCanvaDesign,
  getCanvaDesign,
  getCanvaStatus,
  type CanvaDesign,
  type CanvaStatus,
} from "./canva-api";

export default function CanvaApprovalAction({ contentRequestId }: { contentRequestId: string }) {
  const [status, setStatus] = useState<CanvaStatus | null>(null);
  const [design, setDesign] = useState<CanvaDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function createDesign() {
    setWorking(true);
    setError("");
    try {
      const result = await createCanvaDesign(contentRequestId);
      setDesign(result.design);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar a versão no Canva.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function prepare() {
      const query = new URLSearchParams(window.location.search);
      const callbackMessage = query.get("canvaMessage");
      if (query.get("canva") === "error" && callbackMessage) setError(callbackMessage);

      try {
        const [nextStatus, nextDesign] = await Promise.all([
          getCanvaStatus(),
          getCanvaDesign(contentRequestId),
        ]);
        if (!active) return;
        setStatus(nextStatus);
        setDesign(nextDesign.design);

        if (nextStatus.connected && !nextDesign.design) {
          setWorking(true);
          setError("");
          try {
            const result = await createCanvaDesign(contentRequestId);
            if (active) setDesign(result.design);
          } catch (caught) {
            if (active) {
              setError(caught instanceof Error ? caught.message : "Não foi possível criar a versão no Canva.");
            }
          } finally {
            if (active) setWorking(false);
          }
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar o Canva.");
      } finally {
        if (active) setLoading(false);
      }

      if (query.has("canva") || query.has("canvaMessage")) {
        query.delete("canva");
        query.delete("canvaMessage");
        const next = query.toString();
        window.history.replaceState({}, "", \`${window.location.pathname}\${next ? \`?\${next}\` : ""}\`);
      }
    }

    void prepare();
    return () => { active = false; };
  }, [contentRequestId]);

  async function handleConnect() {
    setWorking(true);
    setError("");
    try {
      const result = await connectCanva(contentRequestId);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível conectar o Canva.");
      setWorking(false);
    }
  }

  if (loading) {
    return <section className="canva-approval-action loading"><span className="portal-spinner" /><p>Preparando a etapa Canva...</p></section>;
  }

  if (!status?.integrationConfigured) {
    return (
      <section className="canva-approval-action unavailable">
        <div><small>ETAPA PÓS-APROVAÇÃO</small><strong>Canva aguardando ativação</strong><p>A peça já está aprovada. A conexão Canva será exibida quando o aplicativo estiver configurado pela MODO.</p></div>
      </section>
    );
  }

  return (
    <section className="canva-approval-action">
      <div className="canva-approval-copy">
        <small>ETAPA PÓS-APROVAÇÃO</small>
        <strong>{design ? "Versão criada no Canva" : status.connected ? working ? "Criando a versão no Canva..." : "Preparar versão editável" : "Conectar o Canva"}</strong>
        <p>{design ? "O design aprovado está vinculado a este pedido e pode ser aberto para acabamento." : status.connected ? working ? "A aprovação foi concluída. A MODO está enviando a imagem aprovada e criando o design automaticamente." : "A conta está conectada. A criação automática pode ser repetida sem duplicar o design." : status.message}</p>
        {error && <div className="portal-error">{error}</div>}
      </div>
      <div className="canva-approval-actions">
        {design ? (
          <a className="button button-primary" href={design.editUrl} target="_blank" rel="noreferrer">Abrir no Canva ↗</a>
        ) : status.connected ? (
          <button className="button button-primary" type="button" disabled={working} onClick={() => void createDesign()}>{working ? "Criando no Canva..." : error ? "Tentar novamente" : "Criar agora"}</button>
        ) : (
          <button className="button button-primary" type="button" disabled={working} onClick={() => void handleConnect()}>{working ? "Abrindo autorização..." : "Conectar Canva"}</button>
        )}
      </div>
      <p className="canva-governance-note">Somente a versão aprovada é enviada. O Canva é usado para acabamento e edição; nenhuma publicação ou campanha é ativada automaticamente.</p>
    </section>
  );
}
`,
);

fs.rmSync("scripts/apply-embedded-assets-canva-fix.mjs");
fs.rmSync(".github/workflows/apply-embedded-assets-canva-fix.yml");
console.log("Preview incorporado e pós-aprovação Canva corrigidos.");
