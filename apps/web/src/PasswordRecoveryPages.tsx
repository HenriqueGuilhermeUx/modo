import { type FormEvent, useMemo, useState } from "react";
import { requestPasswordReset, resetPassword } from "./password-reset-api";

type WorkspaceMode = "business" | "agency";

function currentMode(): WorkspaceMode {
  return new URLSearchParams(window.location.search).get("mode") === "agency" ? "agency" : "business";
}

function backHref(mode: WorkspaceMode) {
  return mode === "agency" ? "/app?mode=agency" : "/app";
}

function RecoveryShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="password-recovery-shell">
      <a className="password-recovery-logo" href="/"><img src="/logo.svg" alt="MODO" /></a>
      <section className="password-recovery-card">{children}</section>
      <style>{`
        .password-recovery-shell{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:24px;padding:32px 18px;background:radial-gradient(circle at 20% 10%,#eaf1ff 0,transparent 36%),#f4f7fb;color:#0d1b3e;box-sizing:border-box}.password-recovery-logo img{width:132px}.password-recovery-card{width:min(460px,calc(100vw - 36px));background:#fff;border:1px solid #dfe6f1;border-radius:24px;padding:30px;box-shadow:0 24px 70px rgba(13,27,62,.1);box-sizing:border-box}.password-recovery-card small{display:block;color:#1f5eff;font-size:9px;font-weight:900;letter-spacing:.12em}.password-recovery-card h1{font:800 31px/1.08 Sora,sans-serif;letter-spacing:-.04em;margin:9px 0 10px}.password-recovery-card>p{color:#647087;font-size:13px;line-height:1.6;margin:0 0 22px}.password-recovery-card form{display:grid;gap:14px}.password-recovery-card label{display:grid;gap:7px;font-size:11px;font-weight:900}.password-recovery-card input{width:100%;box-sizing:border-box;border:1px solid #d5deec;border-radius:12px;background:#fbfcff;padding:13px 14px;color:#0d1b3e;font:500 14px Inter,sans-serif;outline:none}.password-recovery-card input:focus{border-color:#1f5eff;box-shadow:0 0 0 3px rgba(31,94,255,.1)}.password-recovery-card button{border:0;border-radius:12px;padding:13px 16px;background:#1f5eff;color:#fff;font-weight:900;cursor:pointer}.password-recovery-card button:disabled{opacity:.55;cursor:not-allowed}.password-recovery-message{border-radius:12px;padding:12px 13px;font-size:12px;line-height:1.5}.password-recovery-message.success{background:#eafaf4;color:#087655}.password-recovery-message.error{background:#fff0f0;color:#a52626}.password-recovery-rules{margin:-4px 0 0;color:#7a8498;font-size:10px;line-height:1.5}.password-recovery-back{display:inline-flex;margin-top:20px;color:#1f5eff;text-decoration:none;font-size:11px;font-weight:900}.password-recovery-done{text-align:center}.password-recovery-done .done-mark{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;margin:0 auto 18px;background:#e7faf3;color:#087655;font-size:25px;font-weight:900}.password-recovery-done a{display:inline-flex;margin-top:12px;border-radius:12px;padding:13px 17px;background:#1f5eff;color:#fff;text-decoration:none;font-weight:900;font-size:12px}@media(max-width:520px){.password-recovery-card{padding:24px 20px}.password-recovery-card h1{font-size:27px}}
      `}</style>
    </main>
  );
}

export function ForgotPasswordPage() {
  const mode = currentMode();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await requestPasswordReset(email, mode);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a recuperação.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RecoveryShell>
      <small>RECUPERAÇÃO DE ACESSO</small>
      <h1>Recupere sua senha da MODO.</h1>
      <p>Informe o e-mail usado na sua conta. Se ele estiver cadastrado, enviaremos um link de uso único válido por 30 minutos.</p>
      {sent ? (
        <div className="password-recovery-done">
          <div className="done-mark">✓</div>
          <h2>Confira seu e-mail</h2>
          <p>Se existir uma conta com esse endereço, o link para criar uma nova senha já foi solicitado.</p>
          <a href={backHref(mode)}>Voltar para entrar</a>
        </div>
      ) : (
        <>
          <form onSubmit={submit}>
            <label>E-mail da conta<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            {error && <div className="password-recovery-message error">{error}</div>}
            <button disabled={submitting}>{submitting ? "Enviando..." : "Enviar link de recuperação"}</button>
          </form>
          <a className="password-recovery-back" href={backHref(mode)}>← Voltar para entrar</a>
        </>
      )}
    </RecoveryShell>
  );
}

export function ResetPasswordPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode: WorkspaceMode = params.get("mode") === "agency" ? "agency" : "business";
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Este link não contém um token de recuperação válido.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Use pelo menos 8 caracteres, incluindo uma letra e um número.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setCompleted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível redefinir a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RecoveryShell>
      {completed ? (
        <div className="password-recovery-done">
          <div className="done-mark">✓</div>
          <small>SENHA ATUALIZADA</small>
          <h1>Pronto. Seu acesso foi protegido.</h1>
          <p>Todas as sessões antigas foram encerradas. Entre novamente usando a nova senha.</p>
          <a href={backHref(mode)}>Entrar na MODO</a>
        </div>
      ) : (
        <>
          <small>NOVA SENHA</small>
          <h1>Crie uma nova senha.</h1>
          <p>O link é de uso único. Depois da troca, suas sessões anteriores serão encerradas por segurança.</p>
          <form onSubmit={submit}>
            <label>Nova senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <label>Confirmar nova senha<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <div className="password-recovery-rules">Mínimo de 8 caracteres, com pelo menos uma letra e um número.</div>
            {error && <div className="password-recovery-message error">{error}</div>}
            <button disabled={submitting || !token}>{submitting ? "Atualizando..." : "Salvar nova senha"}</button>
          </form>
          <a className="password-recovery-back" href={backHref(mode)}>← Voltar para entrar</a>
        </>
      )}
    </RecoveryShell>
  );
}
