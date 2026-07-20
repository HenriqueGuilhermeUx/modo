import type { InvitationPreview } from "@modo/contracts/admin";
import { type FormEvent, useEffect, useState } from "react";
import { acceptInvitation, previewInvitation } from "./admin-api";

const planLabels: Record<string, string> = {
  trial: "Teste MODO",
  start: "MODO Start",
  presenca: "MODO Presença",
  pro: "MODO Pro",
  business: "MODO Business",
};

export default function InvitationWorkspace() {
  const token = decodeURIComponent(window.location.pathname.split("/").pop() || "");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    previewInvitation(token)
      .then(setPreview)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Convite inválido."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await acceptInvitation(token, { name, organizationName, password });
      window.location.href = "/app";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aceitar o convite.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="invite-page"><img src="/logo.svg" alt="MODO" /><div className="portal-spinner" /><p>Validando seu convite...</p></main>;
  }

  if (!preview) {
    return <main className="invite-page"><section><img src="/logo.svg" alt="MODO" /><span>CONVITE ENCERRADO</span><h1>Este acesso não está mais disponível.</h1><p>{error || "Solicite um novo convite à equipe MODO."}</p><a className="button button-primary" href="/">Voltar ao site</a></section></main>;
  }

  return (
    <main className="invite-page">
      <section>
        <img src="/logo.svg" alt="MODO" />
        <span>VOCÊ FOI CONVIDADO</span>
        <h1>Sua presença começa com direção.</h1>
        <p>Crie sua conta e entre diretamente no ambiente preparado para sua empresa.</p>
        <div className="invite-benefits">
          <article><small>CONTA</small><strong>{preview.email}</strong></article>
          <article><small>PLANO INICIAL</small><strong>{planLabels[preview.plan]}</strong></article>
          <article><small>BÔNUS</small><strong>{preview.bonusCredits} créditos</strong></article>
          <article><small>VALIDADE</small><strong>{new Date(preview.expiresAt).toLocaleDateString("pt-BR")}</strong></article>
        </div>
        {preview.note && <blockquote>{preview.note}</blockquote>}
        {error && <div className="portal-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <label>Seu nome<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Nome da empresa<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
          <label>Crie uma senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><small>Mínimo de 8 caracteres, com letra e número.</small></label>
          <button className="button button-primary button-full" disabled={submitting}>{submitting ? "Criando seu ambiente..." : "Aceitar convite e entrar"}</button>
        </form>
      </section>
    </main>
  );
}
